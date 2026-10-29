import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { emailCard, issueCard, normalizeCode } from "../giftCards.js";

// Admin: issue, look up, adjust, disable gift cards. Selling them online is handled at checkout (see store.ts).
export const giftCardsRouter = Router();

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

const issueInput = z.object({
  amount: z.number().int().min(100, "Minimum is 1.00").max(1_000_000, "That is too large"), // minor units
  currency: z.string().length(3),
  recipientEmail: z.string().trim().email().or(z.literal("")).default(""),
  note: z.string().trim().max(500).default(""),
  expiresAt: z.string().datetime().nullable().optional(),
  send: z.boolean().default(false),
});

giftCardsRouter.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const status = String(req.query.status ?? "all");
  const cards = await prisma.giftCard.findMany({
    where: {
      ...(q ? { OR: [{ code: { contains: normalizeCode(q) } }, { recipientEmail: { contains: q } }, { note: { contains: q } }] } : {}),
      ...(status === "active" ? { active: true, balance: { gt: 0 } } : status === "disabled" ? { active: false } : status === "used" ? { balance: 0 } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(cards);
});

giftCardsRouter.get("/:id", async (req, res) => {
  const c = await prisma.giftCard.findUnique({ where: { id: req.params.id }, include: { txs: { orderBy: { createdAt: "desc" } } } });
  if (!c) return void res.status(404).json({ error: "gift card not found" });
  const orders = await prisma.order.findMany({ where: { id: { in: c.txs.map((t) => t.orderId).filter((x): x is string => !!x) } }, select: { id: true, number: true } });
  res.json({ ...c, txs: c.txs.map((t) => ({ ...t, orderNumber: orders.find((o) => o.id === t.orderId)?.number ?? null })) });
});

giftCardsRouter.post("/", async (req, res) => {
  const d = issueInput.parse(req.body);
  if (!(await prisma.market.findFirst({ where: { currency: d.currency } }))) throw bad(`No market uses ${d.currency}`);
  if (d.send && !d.recipientEmail) throw bad("Enter the recipient's email to send the gift card");
  const card = await issueCard({ amount: d.amount, currency: d.currency, recipientEmail: d.recipientEmail, note: d.note, expiresAt: d.expiresAt ? new Date(d.expiresAt) : null });
  const mail = d.send ? await emailCard(card, d.recipientEmail) : null;
  res.status(201).json({ ...card, emailed: mail?.status ?? null, emailError: mail?.error ?? null });
});

giftCardsRouter.post("/:id/email", async (req, res) => {
  const d = z.object({ to: z.string().trim().email() }).parse(req.body);
  const c = await prisma.giftCard.findUnique({ where: { id: req.params.id } });
  if (!c) return void res.status(404).json({ error: "gift card not found" });
  if (!c.active || c.balance <= 0) throw bad("Only a gift card with a balance can be sent", 409);
  const r = await emailCard(c, d.to);
  if (r.status !== "sent") throw bad(r.error ?? "Could not send the email", 502);
  await prisma.giftCard.update({ where: { id: c.id }, data: { recipientEmail: d.to } });
  res.json({ sent: true });
});

giftCardsRouter.patch("/:id", async (req, res) => {
  const d = z.object({ active: z.boolean().optional(), note: z.string().trim().max(500).optional(), expiresAt: z.string().datetime().nullable().optional() }).parse(req.body);
  const r = await prisma.giftCard.updateMany({ where: { id: req.params.id }, data: { active: d.active, note: d.note, expiresAt: d.expiresAt === undefined ? undefined : d.expiresAt && new Date(d.expiresAt) } });
  if (!r.count) return void res.status(404).json({ error: "gift card not found" });
  res.json(await prisma.giftCard.findUnique({ where: { id: req.params.id } }));
});

// Manual balance correction, always with a reason, always in the ledger.
giftCardsRouter.post("/:id/adjust", async (req, res) => {
  const d = z.object({ amount: z.number().int().refine((n) => n !== 0, "Enter an amount"), note: z.string().trim().min(1, "Give a reason").max(300) }).parse(req.body);
  const out = await prisma.$transaction(async (tx) => {
    const r = await tx.giftCard.updateMany({ where: { id: req.params.id, balance: { gte: d.amount < 0 ? -d.amount : 0 } }, data: { balance: { increment: d.amount } } });
    if (!r.count) return null;
    await tx.giftCardTx.create({ data: { giftCardId: req.params.id, amount: d.amount, kind: "adjust", note: d.note } });
    return tx.giftCard.findUnique({ where: { id: req.params.id } });
  });
  if (!out) throw bad("Card not found, or the balance is too low for that deduction", 409);
  res.json(out);
});
