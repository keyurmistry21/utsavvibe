import { Router } from "express";
import type { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { hashPassword, readCookie, sessionToken, verifyPassword } from "../auth.js";
import { signJwt, sign, verifyJwt } from "../secrets.js";
import { rateLimit } from "../rateLimit.js";
import { passwordResetEmail } from "../emails.js";
import { sendMail } from "../mail.js";

// Storefront customer accounts: email + password, and the market (currency/country) the shopper last chose, so the shop
// opens in it next time. Accounts expose only email, name and that preference: no addresses or order history.
export const accountRouter = Router();

const COOKIE = "uv_customer";
const SESSION_MS = 30 * 24 * 3600 * 1000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const password = z.string().min(10, "Use at least 10 characters").max(200);

// Same CSRF rule as the admin: writes must come from our own origin.
accountRouter.use((req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.header("origin");
    if (origin && origin !== new URL(process.env.STOREFRONT_URL ?? "http://localhost:5173").origin) return void res.status(403).json({ error: "bad origin" });
    if (req.header("sec-fetch-site") === "cross-site") return void res.status(403).json({ error: "bad origin" });
  }
  next();
});

async function startSession(res: Response, customerId: string) {
  const sid = randomBytes(16).toString("hex");
  const token = signJwt({ sub: customerId, sid, aud: "customer" }, SESSION_MS / 1000);
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await prisma.customerSession.create({ data: { id: sid, tokenHash: sha(token), customerId, expiresAt } });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: expiresAt, path: "/" });
}

export async function currentCustomer(req: Request) {
  const token = sessionToken(req, COOKIE);
  const c = token ? verifyJwt(token) : null;
  if (!token || !c || c.aud !== "customer") return null;
  const s = await prisma.customerSession.findUnique({ where: { tokenHash: sha(token) }, include: { customer: true } });
  if (!s || s.id !== c.sid || s.customerId !== c.sub || s.expiresAt < new Date()) return null;
  return s.customer;
}

const view = (c: { email: string | null; name: string; preferredMarket: string | null }) => ({ email: c.email, name: c.name, preferredMarket: c.preferredMarket });
const activeMarket = async (code?: string | null) => {
  if (!code) return null;
  const m = await prisma.market.findFirst({ where: { code: code.toUpperCase(), active: true } });
  return m?.code ?? null;
};

// brute-force guard per email+IP (in memory)
const fails = new Map<string, { n: number; until: number }>();
const locked = (k: string) => {
  const f = fails.get(k);
  if (f && f.until < Date.now()) fails.delete(k);
  return (fails.get(k)?.n ?? 0) >= 5;
};
const dummy = hashPassword("not-a-real-password");

accountRouter.post("/register", rateLimit({ windowMs: 3600_000, max: 10, message: "Too many sign-ups from this network. Try again later." }), async (req, res) => {
  const d = z.object({ email: z.string().trim().toLowerCase().email().max(200), name: z.string().trim().min(1, "Enter your name").max(100), password, market: z.string().max(8).optional() }).parse(req.body);
  const existing = await prisma.customer.findUnique({ where: { email: d.email } });
  if (existing?.passwordHash) throw bad("An account with this email already exists. Sign in instead.", 409);
  const preferredMarket = await activeMarket(d.market);
  const passwordHash = await hashPassword(d.password);
  // a guest who bought before simply gets a password on their existing customer record
  const c = existing
    ? await prisma.customer.update({ where: { id: existing.id }, data: { passwordHash, name: existing.name || d.name, preferredMarket } })
    : await prisma.customer.create({ data: { email: d.email, name: d.name, passwordHash, preferredMarket, tags: "[]", notes: "" } });
  await startSession(res, c.id);
  res.status(201).json(view(c));
});

accountRouter.post("/login", async (req, res) => {
  const d = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).parse(req.body);
  const key = `${d.email}|${req.ip}`;
  if (locked(key)) throw bad("Too many attempts. Try again in 15 minutes.", 429);
  const c = await prisma.customer.findUnique({ where: { email: d.email } });
  const ok = await verifyPassword(d.password, c?.passwordHash ?? (await dummy)); // same cost whether or not the account exists
  if (!c?.passwordHash || !ok) {
    const f = fails.get(key);
    fails.set(key, { n: (f?.n ?? 0) + 1, until: f?.until ?? Date.now() + 15 * 60_000 });
    throw bad("Invalid email or password", 401);
  }
  fails.delete(key);
  await startSession(res, c.id);
  res.json(view(c));
});

accountRouter.post("/logout", async (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) await prisma.customerSession.deleteMany({ where: { tokenHash: sha(token) } });
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

accountRouter.get("/me", async (req, res) => {
  const c = await currentCustomer(req);
  if (!c) return void res.status(401).json({ error: "unauthorized" });
  res.json(view(c));
});

// Remember the market the shopper chose (currency, prices and products follow it next time they sign in).
accountRouter.put("/me", async (req, res) => {
  const c = await currentCustomer(req);
  if (!c) return void res.status(401).json({ error: "unauthorized" });
  const d = z.object({ preferredMarket: z.string().max(8).optional(), name: z.string().trim().min(1).max(100).optional() }).parse(req.body);
  const market = d.preferredMarket ? await activeMarket(d.preferredMarket) : undefined;
  if (d.preferredMarket && !market) throw bad("Unknown market");
  res.json(view(await prisma.customer.update({ where: { id: c.id }, data: { ...(market ? { preferredMarket: market } : {}), ...(d.name ? { name: d.name } : {}) } })));
});

// ---- forgot / reset password ----
// Stateless single-use token: signed over the customer, expiry and the CURRENT password hash, so it dies once the password changes.
const resetToken = (id: string, exp: number, hash: string) => sign(`reset:${id}:${exp}:${hash.slice(-16)}`);

accountRouter.post("/forgot", rateLimit({ windowMs: 3600_000, max: 8 }), async (req, res) => {
  const d = z.object({ email: z.string().trim().toLowerCase().email(), market: z.string().max(8).default("uk") }).parse(req.body);
  const c = await prisma.customer.findUnique({ where: { email: d.email } });
  if (c?.passwordHash && c.email) {
    const exp = Date.now() + 3600_000;
    const url = `${(process.env.STOREFRONT_URL ?? "").replace(/\/$/, "")}/${d.market.toLowerCase().replace(/[^a-z]/g, "").slice(0, 8) || "uk"}/account/reset?c=${c.id}&e=${exp}&t=${resetToken(c.id, exp, c.passwordHash)}`;
    void sendMail({ to: c.email, kind: "password_reset", ...passwordResetEmail(url) });
  }
  res.json({ ok: true }); // same answer whether or not the account exists
});

accountRouter.post("/reset", async (req, res) => {
  const d = z.object({ c: z.string().max(40), e: z.coerce.number(), t: z.string().max(64), password }).parse(req.body);
  const c = await prisma.customer.findUnique({ where: { id: d.c } });
  if (!c?.passwordHash || d.e < Date.now() || d.t !== resetToken(c.id, d.e, c.passwordHash)) throw bad("This reset link has expired or was already used. Ask for a new one.");
  await prisma.customer.update({ where: { id: c.id }, data: { passwordHash: await hashPassword(d.password) } });
  await prisma.customerSession.deleteMany({ where: { customerId: c.id } }); // sign out everywhere
  res.json({ ok: true });
});
