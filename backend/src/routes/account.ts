import { Router } from "express";
import type { Request, Response } from "express";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { readCookie } from "../auth.js";
import { esc } from "../emails.js";
import { sendMail, storeName } from "../mail.js";
import { rateLimit } from "../rateLimit.js";
import { sign } from "../secrets.js";

// Storefront customer accounts: email + 6-digit code, no passwords to leak or forget. Mounted at /api/store/account.
export const accountRouter = Router();
const COOKIE = "uv_cust";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const prod = process.env.NODE_ENV === "production";

export async function customerFrom(req: Request) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const s = await prisma.customerSession.findUnique({ where: { tokenHash: sha(token) } });
  if (!s || s.expiresAt < new Date()) return null;
  return prisma.customer.findUnique({ where: { id: s.customerId } });
}

const hashCode = (email: string, code: string) => sha(`${email}:${code}:${sign("customer-login")}`);

// Always answers the same way, so nobody can find out which emails have accounts. 3 codes per email per 10 minutes.
accountRouter.post("/request-code", rateLimit({ windowMs: 10 * 60_000, max: 12, message: "Too many attempts. Please wait a few minutes." }), async (req, res) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body);
  const recent = await prisma.customerLogin.count({ where: { email, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } });
  if (recent < 3) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await prisma.customerLogin.create({ data: { email, codeHash: hashCode(email, code), expiresAt: new Date(Date.now() + 10 * 60_000) } });
    const name = storeName();
    await sendMail({
      to: email, kind: "login_code", subject: `Your ${name} sign-in code: ${code}`,
      html: `<p>Your sign-in code for ${esc(name)} is:</p><p style="font-size:28px;font-weight:700;letter-spacing:.2em">${code}</p><p>It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>`,
      text: `Your ${name} sign-in code is ${code}. It works for 10 minutes. If you didn't ask for it, ignore this email.`,
    });
  }
  res.json({ ok: true });
});

accountRouter.post("/verify", rateLimit({ windowMs: 10 * 60_000, max: 20, message: "Too many attempts. Please wait a few minutes." }), async (req: Request, res: Response) => {
  const d = z.object({ email: z.string().trim().toLowerCase().email(), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }).parse(req.body);
  const login = await prisma.customerLogin.findFirst({ where: { email: d.email, expiresAt: { gt: new Date() }, attempts: { lt: 5 } }, orderBy: { createdAt: "desc" } });
  if (!login) throw bad("That code has expired. Ask for a new one.", 401);
  const given = Buffer.from(hashCode(d.email, d.code)), want = Buffer.from(login.codeHash);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    await prisma.customerLogin.update({ where: { id: login.id }, data: { attempts: { increment: 1 } } });
    throw bad("That code isn't right", 401);
  }
  await prisma.customerLogin.deleteMany({ where: { email: d.email } }); // one use
  const customer = await prisma.customer.upsert({ where: { email: d.email }, create: { email: d.email, tags: "[]", notes: "" }, update: {} });
  const token = randomBytes(32).toString("base64url");
  await prisma.customerSession.create({ data: { tokenHash: sha(token), customerId: customer.id, expiresAt: new Date(Date.now() + 30 * 86400_000) } });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: prod, maxAge: 30 * 86400_000, path: "/" });
  res.json({ email: customer.email, name: customer.name });
});

accountRouter.post("/logout", async (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) await prisma.customerSession.deleteMany({ where: { tokenHash: sha(token) } });
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

const address = z.object({ line1: z.string().max(200).default(""), line2: z.string().max(200).default(""), city: z.string().max(100).default(""), region: z.string().max(8).default(""), postcode: z.string().max(20).default(""), country: z.string().max(2).default("") });

accountRouter.get("/me", async (req, res) => {
  const c = await customerFrom(req);
  if (!c) return void res.status(401).json({ error: "Sign in to see your account" });
  res.json({ email: c.email, name: c.name, phone: c.phone ?? "", acceptsEmail: c.acceptsEmail, address: parseJson<Record<string, string> | null>(c.address ?? "null", null) });
});

accountRouter.put("/me", async (req, res) => {
  const c = await customerFrom(req);
  if (!c) return void res.status(401).json({ error: "Sign in to see your account" });
  const d = z.object({ name: z.string().trim().max(100), phone: z.string().trim().max(40).default(""), acceptsEmail: z.boolean().default(false), address: address.nullable().optional() }).parse(req.body);
  await prisma.customer.update({ where: { id: c.id }, data: { name: d.name, phone: d.phone || null, acceptsEmail: d.acceptsEmail, ...(d.address ? { address: JSON.stringify(d.address) } : {}) } });
  res.json({ ok: true });
});

// Their own orders (paid or still open), newest first.
accountRouter.get("/orders", async (req, res) => {
  const c = await customerFrom(req);
  if (!c) return void res.status(401).json({ error: "Sign in to see your orders" });
  const orders = await prisma.order.findMany({ where: { customerId: c.id, status: { not: "draft" } }, include: { items: true, market: { select: { code: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json(orders.map((o) => ({ number: o.number, createdAt: o.createdAt, currency: o.currency, total: o.total, status: o.status, paymentStatus: o.paymentStatus, market: o.market.code, trackingNumber: o.trackingNumber, trackingUrl: o.trackingUrl && /^https:\/\//.test(o.trackingUrl) ? o.trackingUrl : null, carrier: o.carrier, items: o.items.map((i) => ({ title: i.title, quantity: i.quantity })) })));
});
