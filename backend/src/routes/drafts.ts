import { Router } from "express";
import type { Request } from "express";
import { assertMarketAllowed, orderScopeParam } from "../auth.js";
import { z } from "zod";
import { prisma, nextOrderNumber } from "../db.js";
import { priceTotals, pickShipping, taxRateFor } from "../money.js";
import { canSell, shouldDecrement } from "../stock.js";
import { createCheckoutSession } from "../checkout.js";
import { stripe } from "../stripe.js";
import { sendOrderConfirmation, sendPaymentLinkEmail } from "../orderEmails.js";

// Draft orders: staff-created orders (phone/WhatsApp/wholesale). Become real orders once paid.
export const draftsRouter = Router();

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

const draftInput = z.object({
  marketId: z.string(),
  // staff can save a draft with only products; customer and address are needed before collecting payment
  customerId: z.string().nullable().optional(),
  // catalog item (variantId, price optional override) or custom item (title + price, no stock tracking)
  items: z
    .array(
      z
        .object({
          variantId: z.string().optional(),
          title: z.string().trim().min(1).max(190).optional(),
          quantity: z.number().int().min(1).max(999),
          unitPrice: z.number().int().min(0).optional(),
          // custom items only
          taxable: z.boolean().optional(),
          physical: z.boolean().optional(),
          weightG: z.number().int().min(0).max(1_000_000).optional(),
        })
        .refine((i) => i.variantId || (i.title && i.unitPrice != null), "custom items need a title and a price"),
    )
    .min(1, "add at least one item"),
  address: z
    .object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      company: z.string().optional(),
      phone: z.string().optional(),
      line1: z.string().default(""),
      line2: z.string().optional(),
      city: z.string().default(""),
      region: z.string().optional(),
      postcode: z.string().default(""),
      country: z.string().max(2).default(""),
    })
    .default({ line1: "", city: "", postcode: "", country: "" }),
  shippingRateId: z.string().optional(),
  customShipping: z.number().int().min(0).optional(),
  discount: z.number().int().min(0).default(0),
  discountNote: z.string().optional(),
  notes: z.string().default(""),
  tags: z.array(z.string()).default([]),
});
type DraftInput = z.infer<typeof draftInput>;

// Same pricing rules as the storefront, except staff may override unit prices, shipping and discount.
async function build(d: DraftInput, req: Request) {
  const market = await prisma.market.findUnique({ where: { id: d.marketId }, include: { shippingRates: true, regions: true } });
  if (!market) throw bad("unknown market");
  await assertMarketAllowed(req, market.id); // staff may only create orders in markets an admin allowed
  const lines = [];
  for (const it of d.items) {
    if (!it.variantId) {
      lines.push({ variantId: null as string | null, title: it.title!, quantity: it.quantity, unitPrice: it.unitPrice!, taxable: it.taxable ?? true, physical: it.physical ?? true, weightG: it.weightG ?? 0 });
      continue;
    }
    const v = await prisma.variant.findUnique({ where: { id: it.variantId }, include: { product: true, prices: { where: { marketId: market.id } } } });
    if (v?.product.isGiftCard) throw Object.assign(new Error("Gift cards can't be added to draft orders. Create one under Gift cards instead."), { status: 400 });
    if (!v) throw bad("item not found");
    const unitPrice = it.unitPrice ?? v.prices[0]?.amount;
    if (unitPrice == null) throw bad(`"${v.product.title}" has no price in ${market.name}. Set a custom price.`);
    lines.push({
      variantId: v.id,
      title: v.title === "Default" ? v.product.title : `${v.product.title} — ${v.title}`,
      quantity: it.quantity,
      unitPrice,
      taxable: v.product.chargeTax,
      physical: v.product.physical,
      weightG: v.weightG,
    });
  }
  const customer = d.customerId ? await prisma.customer.findUnique({ where: { id: d.customerId } }) : null;
  if (d.customerId && !customer) throw bad("customer not found");
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const ship = pickShipping(market.shippingRates, subtotal, d.shippingRateId);
  // nothing physical in the order (e.g. only a service) means nothing to ship
  const needsShipping = lines.some((l) => l.physical);
  const shipping = d.customShipping ?? (needsShipping ? ship.amount : 0);
  const taxableSubtotal = lines.filter((l) => l.taxable).reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const taxRateBps = taxRateFor(market, d.address.region || undefined);
  const t = priceTotals({ exempt: customer?.taxExempt, subtotal, taxableSubtotal, discount: d.discount, taxRateBps, inclusive: market.taxInclusive, shipping });
  return { market, customer, taxRateBps, lines, subtotal, shipping, shippingRateName: ship.rate?.name ?? "Shipping", ...t };
}

// Name printed on the label: the address contact if given, else the customer.
const shipName = (d: DraftInput, customerName?: string | null) => `${d.address.firstName ?? ""} ${d.address.lastName ?? ""}`.trim() || customerName || "";

const include = { items: true, customer: true, market: { include: { regions: true } } } as const;
draftsRouter.param("id", orderScopeParam);

draftsRouter.post("/quote", async (req, res) => {
  const d = draftInput.parse(req.body);
  const b = await build(d, req);
  res.json({ region: d.address.region || null, currency: b.market.currency, taxInclusive: b.market.taxInclusive, taxRateBps: b.taxRateBps, lines: b.lines, subtotal: b.subtotal, discount: b.discount, tax: b.tax, shipping: b.shipping, total: b.total });
});

draftsRouter.post("/", async (req, res) => {
  const d = draftInput.parse(req.body);
  const b = await build(d, req);
  const order = await prisma.$transaction(async (tx) => {
    return tx.order.create({
      data: {
        number: await nextOrderNumber(tx),
        status: "draft",
        customerId: b.customer?.id ?? null,
        marketId: b.market.id,
        currency: b.market.currency,
        subtotal: b.subtotal,
        discount: b.discount,
        discountNote: d.discountNote || null,
        tax: b.tax,
        shipping: b.shipping,
        total: b.total,
        shippingName: shipName(d, b.customer?.name),
        shippingAddress: JSON.stringify(d.address),
        notes: d.notes,
        tags: JSON.stringify(d.tags),
        items: { create: b.lines },
      },
      include,
    });
  });
  res.status(201).json(order);
});

async function getDraft(id: string) {
  const o = await prisma.order.findUnique({ where: { id }, include });
  if (!o) throw bad("not found", 404);
  if (o.status !== "draft") throw bad("only draft orders can be changed this way", 409);
  return o;
}

draftsRouter.put("/:id", async (req, res) => {
  await getDraft(req.params.id);
  const d = draftInput.parse(req.body);
  const b = await build(d, req);
  const order = await prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany({ where: { orderId: req.params.id } });
    return tx.order.update({
      where: { id: req.params.id },
      data: {
        customerId: b.customer?.id ?? null,
        marketId: b.market.id,
        currency: b.market.currency,
        subtotal: b.subtotal,
        discount: b.discount,
        discountNote: d.discountNote || null,
        tax: b.tax,
        shipping: b.shipping,
        total: b.total,
        shippingName: shipName(d, b.customer?.name),
        shippingAddress: JSON.stringify(d.address),
        notes: d.notes,
        tags: JSON.stringify(d.tags),
        // prices changed, so any earlier payment link is stale
        paymentLinkUrl: null,
        stripeSessionId: null,
        items: { create: b.lines },
      },
      include,
    });
  });
  res.json(order);
});

// Create a Stripe-hosted payment link the staff member can send to the customer.
// Tax depends on the destination, so regions must be known before money changes hands.
function assertReady(o: Awaited<ReturnType<typeof getDraft>>, needEmail: boolean) {
  if (needEmail && !o.customer?.email) throw bad("Add a customer email before creating a payment link");
  const region = (JSON.parse(o.shippingAddress).region ?? "") as string;
  if (o.market.regions.length && !region) throw bad(`Add the delivery ${o.market.code === "US" ? "state" : "province"} first so tax is correct`);
}

draftsRouter.post("/:id/payment-link", async (req, res) => {
  const o = await getDraft(req.params.id);
  assertReady(o, true);
  if (o.stripeSessionId) await stripe().checkout.sessions.expire(o.stripeSessionId).catch(() => {});
  const session = await createCheckoutSession({
    orderId: o.id,
    orderNumber: o.number,
    marketCode: o.market.code,
    currency: o.currency,
    taxInclusive: o.market.taxInclusive,
    taxRateBps: o.market.regions.find((r) => r.code === (JSON.parse(o.shippingAddress).region ?? "").toUpperCase())?.taxRateBps ?? o.market.taxRateBps,
    lines: o.items,
    tax: o.tax,
    discount: o.discount,
    discountNote: o.discountNote,
    shipping: o.shipping,
    shippingName: "Shipping",
    email: o.customer!.email!,
    expiresInHours: 24,
  });
  await prisma.order.update({ where: { id: o.id }, data: { paymentLinkUrl: session.url, stripeSessionId: session.id } });
  res.json({ url: session.url, expiresInHours: 24 });
});

// Paid outside Stripe (cash, bank transfer). Converts the draft into an open order and takes stock.
draftsRouter.post("/:id/mark-paid", async (req, res) => {
  const { method, notify } = z.object({ method: z.enum(["cash", "bank_transfer", "other"]), notify: z.boolean().default(true) }).parse(req.body);
  const o = await getDraft(req.params.id);
  assertReady(o, false);
  const order = await prisma.$transaction(async (tx) => {
    for (const i of o.items) {
      if (!i.variantId) continue;
      const v = await tx.variant.findUnique({ where: { id: i.variantId }, include: { product: { select: { trackInventory: true, continueSelling: true } } } });
      if (!v || !canSell(v.product, v.inventory, i.quantity)) throw bad(`insufficient stock for ${i.title}`, 409);
      if (shouldDecrement(v.product)) await tx.variant.update({ where: { id: i.variantId }, data: { inventory: { decrement: i.quantity } } });
    }
    return tx.order.update({ where: { id: o.id }, data: { status: "open", paymentStatus: "paid", paymentMethod: method }, include });
  });
  if (o.stripeSessionId) await stripe().checkout.sessions.expire(o.stripeSessionId).catch(() => {});
  const email = notify ? await sendOrderConfirmation(order.id) : { status: "skipped" as const };
  res.json({ ...order, email: email.status });
});

// Email the existing Stripe payment link to the customer (creating it first is a separate click, so staff see the link).
draftsRouter.post("/:id/email-payment-link", async (req, res) => {
  await getDraft(req.params.id);
  const r = await sendPaymentLinkEmail(req.params.id);
  if (r.status === "no_email") throw bad("Add a customer email first");
  if (r.status === "no_link") throw bad("Create the payment link first");
  if (r.status !== "sent") throw bad("error" in r && r.error ? r.error : "Could not send the email", 502);
  res.json({ sent: true });
});

draftsRouter.delete("/:id", async (req, res) => {
  const o = await getDraft(req.params.id);
  if (o.stripeSessionId) await stripe().checkout.sessions.expire(o.stripeSessionId).catch(() => {});
  await prisma.order.delete({ where: { id: o.id } });
  res.json({ deleted: true });
});
