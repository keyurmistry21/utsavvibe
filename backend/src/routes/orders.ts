import { csvCell } from "../csv.js";
import { Router } from "express";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { previewEmail, sendOrderConfirmation } from "../orderEmails.js";
import { releaseForOrder } from "../giftCards.js";
import { orderScopeParam, scopeCodes, scopeLocations } from "../auth.js";
import { emitOrder } from "../webhooks.js";
import { audit } from "../audit.js";
import { stripe } from "../stripe.js";
import { adjustStock, adjustLocationStock } from "../stock.js";

export const ordersRouter = Router();
ordersRouter.param("id", orderScopeParam);

const include = { items: true, customer: true, market: { include: { regions: true } }, refunds: { orderBy: { createdAt: "desc" } } } as const;
const shape = (o: any) => ({
  ...o,
  tags: parseJson<string[]>(o.tags, []),
  shippingAddress: parseJson(o.shippingAddress, {}),
  taxBreakdown: parseJson<{ name: string; amount: number }[]>(o.taxBreakdown ?? "[]", []),
  market: o.market && { ...o.market, countries: parseJson(o.market.countries, []) },
});

// Same filters for the list and the CSV export: status, payment, channel, market, location, and a date range.
function orderWhere(req: Parameters<typeof scopeCodes>[0]) {
  const { status, paymentStatus, marketId, market, channel, location, from, to } = req.query as Record<string, string | undefined>;
  const scope = scopeCodes(req); // staff limited to some markets only ever see those
  const locScope = scopeLocations(req); // ... and counter staff only see in-store sales from their own locations (online orders stay visible)
  const day = (v?: string, end = false) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${end ? "23:59:59.999" : "00:00:00"}`) : undefined);
  const gte = day(from), lte = day(to, true);
  return {
    // drafts live under /drafts or ?status=draft; they are not orders yet
    status: status ? status : { not: "draft" },
    ...(paymentStatus && { paymentStatus }),
    ...((channel === "online" || channel === "in_store") && { channel }),
    ...(location && { locationId: location }),
    ...(locScope ? { OR: [{ channel: "online" }, { locationId: { in: locScope } }] } : {}),
    ...(marketId && { marketId }),
    ...(market ? { market: { code: scope && !scope.includes(market.toUpperCase()) ? "-" : market.toUpperCase() } } : scope ? { market: { code: { in: scope } } } : {}),
    ...((gte || lte) && { createdAt: { ...(gte && { gte }), ...(lte && { lte }) } }),
  };
}

ordersRouter.get("/", async (req, res) => {
  const orders = await prisma.order.findMany({ where: orderWhere(req), include, orderBy: { createdAt: "desc" }, take: 200 });
  res.json(orders.map(shape));
});

// Locations the signed-in staff member can filter by.
ordersRouter.get("/locations", async (req, res) => {
  const scope = scopeLocations(req);
  const rows = await prisma.location.findMany({ where: { active: true, ...(scope ? { id: { in: scope } } : {}) }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } });
  res.json(rows);
});

// CSV of the orders the filters match (one row per order). Amounts are in the order's own currency, never mixed.
ordersRouter.get("/export.csv", async (req, res) => {
  const orders = await prisma.order.findMany({ where: orderWhere(req), include, orderBy: { createdAt: "desc" }, take: 5000 });
  const head = ["Order", "Date", "Customer", "Email", "Market", "Currency", "Channel", "Location", "Items", "Subtotal", "Discount", "Shipping", "Tax", "Total", "Refunded", "Payment", "Status", "Tags"];
  const m = (n: number) => (n / 100).toFixed(2);
  const lines = orders.map((o: any) => [
    o.number, o.createdAt.toISOString(), o.customer?.name ?? "", o.customer?.email ?? "", o.market?.code ?? "", o.currency, o.channel === "in_store" ? "In-store" : "Online", o.locationName ?? "",
    o.items.reduce((n: number, i: any) => n + i.quantity, 0), m(o.subtotal), m(o.discount ?? 0), m(o.shipping), m(o.tax), m(o.total), m(o.refundedAmount ?? 0), o.paymentStatus, o.status, parseJson<string[]>(o.tags, []).join(", "),
  ].map(csvCell).join(","));
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("\uFEFF" + [head.map(csvCell).join(","), ...lines].join("\r\n"));
});

// Numbers above the order list: orders, items, sales and refunds for a period. Sales are kept per currency, never added across markets.
ordersRouter.get("/stats/summary", async (req, res) => {
  const { range, market, channel, location } = req.query as Record<string, string | undefined>;
  const scope = scopeCodes(req);
  const locScope = scopeLocations(req);
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  else if (range === "30d") start.setDate(start.getDate() - 29);
  else if (range === "year") { start.setMonth(0, 1); }
  const orders = await prisma.order.findMany({
    where: {
      status: { notIn: ["draft"] }, createdAt: { gte: start },
      ...((channel === "online" || channel === "in_store") && { channel }),
      ...(location && { locationId: location }),
      ...(locScope ? { OR: [{ channel: "online" }, { locationId: { in: locScope } }] } : {}),
      ...(market ? { market: { code: scope && !scope.includes(market.toUpperCase()) ? "-" : market.toUpperCase() } } : scope ? { market: { code: { in: scope } } } : {}),
    },
    select: { status: true, paymentStatus: true, currency: true, total: true, refundedAmount: true, items: { select: { quantity: true } } },
  });
  const money = new Map<string, { sales: number; refunds: number }>();
  let items = 0, fulfilled = 0, toFulfil = 0;
  for (const o of orders) {
    items += o.items.reduce((a, i) => a + i.quantity, 0);
    if (o.status === "fulfilled") fulfilled++;
    if (o.status === "open" && o.paymentStatus === "paid") toFulfil++;
    if (o.paymentStatus === "paid" || o.paymentStatus === "refunded" || o.paymentStatus === "partially_refunded") {
      const m = money.get(o.currency) ?? { sales: 0, refunds: 0 };
      m.sales += o.total; m.refunds += o.refundedAmount ?? 0; money.set(o.currency, m);
    }
  }
  res.json({ orders: orders.length, items, fulfilled, toFulfil, money: [...money].map(([currency, v]) => ({ currency, ...v })) });
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

// ---- Refunds and returns ----
// Stripe-paid orders are refunded through Stripe (the money goes back to the card); cash, bank transfer and gift card orders
// are recorded as a manual refund (staff hand the money back). Items can be returned to stock in the same step.
const refundInput = z.object({
  amount: z.number().int().min(1),
  reason: z.string().trim().max(300).default(""),
  restock: z.array(z.object({ itemId: z.string(), quantity: z.number().int().min(1).max(999) })).default([]),
});

ordersRouter.post("/:id/refund", async (req, res) => {
  const d = refundInput.parse(req.body);
  const o = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true, customer: true, market: true } });
  if (!o) return void res.status(404).json({ error: "not found" });
  if (o.paymentStatus !== "paid") return void res.status(409).json({ error: o.paymentStatus === "refunded" ? "This order is already fully refunded" : "Only paid orders can be refunded" });
  const left = o.total - o.refundedAmount;
  if (d.amount > left) return void res.status(400).json({ error: `You can refund at most ${(left / 100).toFixed(2)} ${o.currency}` });

  // returning items: only lines of this order, never more than were bought
  const back: { itemId: string; title: string; quantity: number; variantId: string; track: boolean }[] = [];
  for (const r of d.restock) {
    const it = o.items.find((i) => i.id === r.itemId);
    if (!it || !it.variantId) return void res.status(400).json({ error: "That item can't be returned to stock" });
    if (r.quantity > it.quantity) return void res.status(400).json({ error: `Only ${it.quantity} of ${it.title} were bought` });
    const v = await prisma.variant.findUnique({ where: { id: it.variantId }, include: { product: { select: { trackInventory: true } } } });
    back.push({ itemId: it.id, title: it.title, quantity: r.quantity, variantId: it.variantId, track: !!v?.product.trackInventory });
  }

  let stripeRefundId: string | null = null;
  const viaStripe = o.paymentMethod === "stripe" && !!o.stripePaymentIntentId;
  if (viaStripe) {
    const stripeShare = o.total - o.giftCardAmount; // the part of the total that was charged to the card
    if (d.amount + o.refundedAmount > stripeShare && o.giftCardAmount > 0) return void res.status(400).json({ error: "Part of this order was paid by gift card. Refund the card part here and adjust the gift card under Gift cards." });
    try {
      const r = await stripe().refunds.create({ payment_intent: o.stripePaymentIntentId!, amount: d.amount, reason: "requested_by_customer", metadata: { orderId: o.id } }, { idempotencyKey: `refund-${o.id}-${o.refundedAmount}-${d.amount}` });
      stripeRefundId = r.id;
    } catch (e) {
      return void res.status(502).json({ error: `Stripe could not refund: ${(e as Error).message}` });
    }
  }

  const user = (req as any).user as { email: string } | undefined;
  const full = o.refundedAmount + d.amount >= o.total;
  await prisma.$transaction(async (tx) => {
    await tx.orderRefund.create({ data: { orderId: o.id, amount: d.amount, method: viaStripe ? "stripe" : "manual", reason: d.reason, restocked: JSON.stringify(back.map((b) => ({ title: b.title, quantity: b.quantity }))), stripeRefundId, createdByEmail: user?.email ?? "" } });
    await tx.order.update({ where: { id: o.id }, data: { refundedAmount: { increment: d.amount }, ...(full ? { paymentStatus: "refunded" } : {}) } });
    // returned items go back to the location that sent them out (else just to the market)
    for (const b of back) if (b.track) { if (o.locationId) await adjustLocationStock(tx, b.variantId, o.locationId, b.quantity); else await adjustStock(tx, b.variantId, o.marketId, b.quantity); }
  });
  await audit(req, "order_refunded", `order #${o.number} ${(d.amount / 100).toFixed(2)} ${o.currency}${viaStripe ? " via Stripe" : " manually"}`);
  if (full) void emitOrder("order.refunded", o.id);
  const fresh = await prisma.order.findUnique({ where: { id: o.id }, include });
  res.json(shape(fresh));
});
