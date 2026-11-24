import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { rateLimit } from "../rateLimit.js";
import { customerFrom } from "./account.js";

// Public: read approved reviews of a product, submit one. Admin: moderate.
export const reviewsPublicRouter = Router();
export const reviewsAdminRouter = Router();
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
// plain text only: strip tags and control characters
const plain = (s: string) => s.replace(/<[^>]*>/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();

reviewsPublicRouter.get("/:handle", async (req, res) => {
  const p = await prisma.product.findFirst({ where: { handle: String(req.params.handle), status: "active" }, select: { id: true } });
  if (!p) return void res.status(404).json({ error: "not found" });
  const rows = await prisma.productReview.findMany({ where: { productId: p.id, status: "approved" }, orderBy: { createdAt: "desc" }, take: 50, select: { name: true, rating: true, title: true, body: true, verified: true, createdAt: true } });
  const agg = await prisma.productReview.aggregate({ where: { productId: p.id, status: "approved" }, _avg: { rating: true }, _count: true });
  res.json({ count: agg._count, average: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : null, reviews: rows });
});

reviewsPublicRouter.post("/:handle", rateLimit({ windowMs: 60 * 60_000, max: 10, message: "Too many reviews from this connection. Try again later." }), async (req, res) => {
  const p = await prisma.product.findFirst({ where: { handle: String(req.params.handle), status: "active" }, select: { id: true } });
  if (!p) return void res.status(404).json({ error: "not found" });
  const d = z.object({ name: z.string().trim().min(1, "Enter your name").max(80), rating: z.number().int().min(1).max(5), title: z.string().trim().max(120).default(""), body: z.string().trim().min(10, "Write at least a sentence").max(3000) }).parse(req.body);
  const customer = await customerFrom(req);
  let verified = false;
  if (customer) {
    verified = !!(await prisma.orderItem.findFirst({ where: { variant: { productId: p.id }, order: { customerId: customer.id, paymentStatus: "paid" } }, select: { id: true } }));
    if (await prisma.productReview.findFirst({ where: { productId: p.id, customerId: customer.id }, select: { id: true } })) throw bad("You've already reviewed this product", 409);
  }
  await prisma.productReview.create({ data: { productId: p.id, customerId: customer?.id ?? null, name: plain(d.name), rating: d.rating, title: plain(d.title), body: plain(d.body), verified, status: verified ? "approved" : "pending" } });
  res.status(201).json({ status: verified ? "approved" : "pending" });
});

// ---- admin ----
reviewsAdminRouter.get("/", async (req, res) => {
  const status = ["pending", "approved", "rejected"].includes(String(req.query.status)) ? String(req.query.status) : "pending";
  const rows = await prisma.productReview.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 200 });
  const products = await prisma.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.productId))] } }, select: { id: true, title: true, handle: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  res.json({ counts: { pending: await prisma.productReview.count({ where: { status: "pending" } }) }, reviews: rows.map((r) => ({ ...r, product: byId.get(r.productId)?.title ?? "(deleted product)" })) });
});

reviewsAdminRouter.put("/:id", async (req, res) => {
  const { status } = z.object({ status: z.enum(["approved", "rejected", "pending"]) }).parse(req.body);
  const r = await prisma.productReview.update({ where: { id: req.params.id }, data: { status } }).catch(() => null);
  if (!r) return void res.status(404).json({ error: "not found" });
  await audit(req, "review_moderated", `${r.id} -> ${status}`);
  res.json(r);
});

reviewsAdminRouter.delete("/:id", async (req, res) => {
  const r = await prisma.productReview.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!r) return void res.status(404).json({ error: "not found" });
  await audit(req, "review_deleted", r.id);
  res.json({ ok: true });
});
