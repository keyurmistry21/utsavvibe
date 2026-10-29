import { Router } from "express";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { previewEmail, sendOrderConfirmation } from "../orderEmails.js";
import { releaseForOrder } from "../giftCards.js";
import { orderScopeParam, scopeCodes } from "../auth.js";
import { emitOrder } from "../webhooks.js";
import { audit } from "../audit.js";

export const ordersRouter = Router();
ordersRouter.param("id", orderScopeParam);

const include = { items: true, customer: true, market: { include: { regions: true } } } as const;
const shape = (o: any) => ({
  ...o,
  tags: parseJson<string[]>(o.tags, []),
  shippingAddress: parseJson(o.shippingAddress, {}),
  market: o.market && { ...o.market, countries: parseJson(o.market.countries, []) },
});

ordersRouter.get("/", async (req, res) => {
  const { status, paymentStatus, marketId, market } = req.query as Record<string, string | undefined>;
  const scope = scopeCodes(req); // staff limited to some markets only ever see those
  const orders = await prisma.order.findMany({
    // drafts live under /drafts or ?status=draft; they are not orders yet
    where: { status: status ? status : { not: "draft" }, ...(paymentStatus && { paymentStatus }), ...(marketId && { marketId }), ...(market ? { market: { code: scope && !scope.includes(market.toUpperCase()) ? "-" : market.toUpperCase() } } : scope ? { market: { code: { in: scope } } } : {}) },
    include,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(orders.map(shape));
});

ordersRouter.get("/:id", async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: req.params.id }, include });
  if (!o) return void res.status(404).json({ error: "not found" });
  res.json(shape(o));
});

ordersRouter.get("/:id/emails", async (req, res) => {
  res.json(await prisma.emailLog.findMany({ where: { orderId: req.params.id }, orderBy: { createdAt: "desc" }, take: 50 }));
});

ordersRouter.post("/:id/resend-confirmation", async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!o) return void res.status(404).json({ error: "not found" });
  if (o.paymentStatus !== "paid") return void res.status(409).json({ error: "Only paid orders have a confirmation" });
  const r = await sendOrderConfirmation(o.id, { force: true });
  if (r.status === "no_email") return void res.status(400).json({ error: "This order has no customer email" });
  if (r.status !== "sent") return void res.status(502).json({ error: ("error" in r && r.error) || "Could not send the email" });
  res.json({ sent: true });
});

// HTML preview of what the customer would receive (works even without SMTP configured).
ordersRouter.get("/:id/email-preview", async (req, res) => {
  const kind = req.query.kind === "payment_link" ? "payment_link" : "order_confirmation";
  const m = await previewEmail(req.params.id, kind);
  if (!m) return void res.status(404).json({ error: "not found" });
  res.json({ subject: m.subject, html: m.html });
});

ordersRouter.patch("/:id", async (req, res) => {
  const d = z
    .object({
      status: z.enum(["open", "fulfilled", "cancelled"]).optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
      carrier: z.string().nullable().optional(),
      trackingNumber: z.string().nullable().optional(),
      trackingUrl: z.string().nullable().optional(),
      packageWeightG: z.number().int().min(0).nullable().optional(),
    })
    .parse(req.body);
  const current = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!current) return void res.status(404).json({ error: "not found" });
  if (current.status === "draft") return void res.status(409).json({ error: "draft orders are edited under Drafts" });
  if (d.status === "fulfilled" && current.paymentStatus !== "paid") return void res.status(409).json({ error: "only paid orders can be fulfilled" });

  const o = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      ...d,
      tags: d.tags && JSON.stringify(d.tags),
      ...(d.status === "fulfilled" && !current.shippedAt ? { shippedAt: new Date() } : {}),
      ...(d.status === "open" ? { shippedAt: null } : {}),
    },
    include,
  });
  if (d.status === "cancelled" && current.status !== "cancelled") {
    await releaseForOrder(o.id); // gift card money goes back on the card
    void emitOrder("order.cancelled", o.id);
    await audit(req, "order_cancelled", `#${o.number}`);
  }
  if (d.status === "fulfilled" && current.status !== "fulfilled") void emitOrder("order.fulfilled", o.id);
  res.json(shape(o));
});
