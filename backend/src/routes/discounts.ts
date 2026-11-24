import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { normalizeCode } from "../discounts.js";

// Admin: storefront discount codes (percent off, fixed amount off, free shipping).
export const discountsRouter = Router();

const input = z
  .object({
    code: z.string().trim().min(3, "Code needs at least 3 characters").max(40).transform(normalizeCode).refine((c) => /^[A-Z0-9_-]+$/.test(c), "Use letters, numbers, - and _ only"),
    kind: z.enum(["percent", "fixed", "free_shipping", "buy_x_get_y"]),
    buyQty: z.number().int().min(0).max(99).default(0),
    getQty: z.number().int().min(0).max(99).default(0),
    getPercent: z.number().int().min(1).max(100).default(100),
    productId: z.string().max(40).nullable().optional(),
    value: z.number().int().min(0).default(0),
    currency: z.string().length(3).toUpperCase().nullable().optional(),
    minSubtotal: z.number().int().min(0).default(0),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    usageLimit: z.number().int().min(1).nullable().optional(),
    active: z.boolean().default(true),
    note: z.string().trim().max(200).default(""),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "percent" && (d.value < 1 || d.value > 100)) ctx.addIssue({ code: "custom", path: ["value"], message: "Percent must be between 1 and 100" });
    if (d.kind === "buy_x_get_y" && (d.buyQty < 1 || d.getQty < 1)) ctx.addIssue({ code: "custom", path: ["buyQty"], message: "Buy at least 1 and get at least 1" });
    if (d.kind === "fixed" && d.value < 1) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter the amount off" });
    if (d.kind === "fixed" && !d.currency) ctx.addIssue({ code: "custom", path: ["currency"], message: "Choose the currency" });
    if (d.startsAt && d.endsAt && d.startsAt > d.endsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start" });
  });

const data = (d: z.infer<typeof input>) => ({
  code: d.code, kind: d.kind, value: d.kind === "free_shipping" ? 0 : d.value, currency: d.kind === "fixed" ? d.currency ?? null : null,
  minSubtotal: d.minSubtotal, startsAt: d.startsAt ? new Date(d.startsAt) : null, endsAt: d.endsAt ? new Date(d.endsAt) : null,
  buyQty: d.kind === "buy_x_get_y" ? d.buyQty : 0, getQty: d.kind === "buy_x_get_y" ? d.getQty : 0, getPercent: d.getPercent, productId: d.kind === "buy_x_get_y" ? d.productId || null : null,
  usageLimit: d.usageLimit ?? null, active: d.active, note: d.note,
});

discountsRouter.get("/", async (_req, res) => res.json(await prisma.discountCode.findMany({ orderBy: { createdAt: "desc" } })));

discountsRouter.post("/", async (req, res) => {
  const d = input.parse(req.body);
  const row = await prisma.discountCode.create({ data: data(d) }).catch((e) => { if (e?.code === "P2002") throw Object.assign(new Error("A discount with that code already exists"), { status: 409 }); throw e; });
  await audit(req, "discount_created", row.code);
  res.status(201).json(row);
});

discountsRouter.put("/:id", async (req, res) => {
  const d = input.parse(req.body);
  const row = await prisma.discountCode.update({ where: { id: req.params.id }, data: data(d) }).catch((e) => { if (e?.code === "P2002") throw Object.assign(new Error("A discount with that code already exists"), { status: 409 }); if (e?.code === "P2025") return null; throw e; });
  if (!row) return void res.status(404).json({ error: "not found" });
  await audit(req, "discount_changed", row.code);
  res.json(row);
});

// Used codes are kept (orders refer to them): they can only be switched off. Unused ones can be deleted.
discountsRouter.delete("/:id", async (req, res) => {
  const row = await prisma.discountCode.findUnique({ where: { id: req.params.id } });
  if (!row) return void res.status(404).json({ error: "not found" });
  if (row.usedCount > 0) return void res.status(409).json({ error: "This code has been used. Switch it off instead of deleting it." });
  await prisma.discountCode.delete({ where: { id: row.id } });
  await audit(req, "discount_deleted", row.code);
  res.json({ ok: true });
});
