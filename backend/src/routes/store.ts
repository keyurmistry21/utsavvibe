import { Router, raw } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { prisma, parseJson, nextOrderNumber } from "../db.js";
import { pickShipping, priceTotals, taxRateFor } from "../money.js";
import { htmlToText } from "../html.js";
import { canSell, shouldDecrement } from "../stock.js";
import { stripe } from "../stripe.js";
import { createCheckoutSession } from "../checkout.js";
import { imageUrls } from "../storage.js";
import { sendOrderConfirmation } from "../orderEmails.js";

// Public storefront API: catalog, quote, checkout. Plus Stripe webhook.
export const storeRouter = Router();

const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 });

storeRouter.get("/markets", async (_req, res) => {
  const markets = await prisma.market.findMany({ where: { active: true }, include: { shippingRates: true, regions: { orderBy: { name: "asc" } } } });
  res.json(markets.map((m) => ({ ...m, countries: parseJson<string[]>(m.countries, []) })));
});

const publicProduct = (
  p: { trackInventory?: boolean; continueSelling?: boolean; seoTitle?: string; seoDescription?: string | null; images?: { id: string; alt: string }[]; markets?: { regions: string | null }[]; id: string; handle: string; title: string; description: string; tags: string; variants: { id: string; title: string; options: string; inventory: number; prices: { amount: number; compareAt: number | null }[] }[] },
  currency: string,
) => ({
  id: p.id,
  handle: p.handle,
  title: p.title,
  description: htmlToText(p.description),
  descriptionHtml: p.description, // sanitized when saved
  seoTitle: p.seoTitle || "",
  seoDescription: p.seoDescription || "",
  tags: parseJson<string[]>(p.tags, []),
  currency,
  images: (p.images ?? []).map((i) => ({ alt: i.alt, ...imageUrls(i.id) })),
  // empty = sold across the whole market; otherwise only these province/state codes
  regions: parseJson<string[]>(p.markets?.[0]?.regions ?? "[]", []),
  variants: p.variants.map((v) => ({
    id: v.id,
    title: v.title,
    options: parseJson(v.options, {}),
    inStock: canSell({ trackInventory: p.trackInventory ?? true, continueSelling: p.continueSelling ?? false }, v.inventory),
    price: v.prices[0]?.amount ?? null,
    compareAt: v.prices[0]?.compareAt ?? null,
  })),
});

const catalogQuery = (marketId: string) => ({
  status: "active",
  markets: { some: { marketId } },
});

storeRouter.get("/markets/:code/products", async (req, res) => {
  const market = await prisma.market.findFirst({ where: { code: req.params.code, active: true } });
  if (!market) return void res.status(404).json({ error: "market not found" });
  const products = await prisma.product.findMany({
    where: catalogQuery(market.id),
    include: { images: { orderBy: { position: "asc" } }, markets: { where: { marketId: market.id } }, variants: { include: { prices: { where: { marketId: market.id } } } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(products.map((p) => publicProduct(p, market.currency)));
});

storeRouter.get("/markets/:code/products/:handle", async (req, res) => {
  const market = await prisma.market.findFirst({ where: { code: req.params.code, active: true } });
  const product =
    market &&
    (await prisma.product.findFirst({
      where: { ...catalogQuery(market.id), handle: req.params.handle },
      include: { images: { orderBy: { position: "asc" } }, markets: { where: { marketId: market.id } }, variants: { include: { prices: { where: { marketId: market.id } } } } },
    }));
  if (!market || !product) return void res.status(404).json({ error: "not found" });
  res.json(publicProduct(product, market.currency));
});

const cartInput = z.object({
  marketCode: z.string(),
  items: z.array(z.object({ variantId: z.string(), quantity: z.number().int().min(1).max(99) })).min(1),
  shippingRateId: z.string().optional(),
  region: z.string().max(8).optional(), // province/state code, drives tax
});

// Server-side pricing: never trust client prices.
async function priceCart(d: z.infer<typeof cartInput>) {
  const market = await prisma.market.findFirst({ where: { code: d.marketCode, active: true }, include: { shippingRates: true, regions: true } });
  if (!market) throw bad("unknown market");
  const region = d.region?.toUpperCase();
  if (region && market.regions.length && !market.regions.some((r) => r.code === region)) throw bad(`unknown region ${region}`);
  const lines = [];
  for (const it of d.items) {
    const v = await prisma.variant.findUnique({
      where: { id: it.variantId },
      include: { product: { include: { markets: true } }, prices: { where: { marketId: market.id } } },
    });
    if (!v || v.product.status !== "active" || !v.product.markets.some((m) => m.marketId === market.id) || !v.prices[0])
      throw bad(`item not available in ${market.name}`);
    const sold = parseJson<string[]>(v.product.markets.find((m) => m.marketId === market.id)?.regions ?? "[]", []);
    if (region && sold.length && !sold.includes(region)) throw bad(`${v.product.title} is not available in ${market.regions.find((r) => r.code === region)?.name ?? region}`);
    if (!canSell(v.product, v.inventory, it.quantity)) throw bad(`insufficient stock for ${v.product.title}`);
    lines.push({
      variantId: v.id,
      title: v.title === "Default" ? v.product.title : `${v.product.title} — ${v.title}`,
      quantity: it.quantity,
      unitPrice: v.prices[0].amount,
      weightG: v.weightG,
      taxable: v.product.chargeTax,
      physical: v.product.physical,
    });
  }
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const taxableSubtotal = lines.filter((l) => l.taxable).reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const taxRateBps = taxRateFor(market, region);
  const ship = pickShipping(market.shippingRates, subtotal, d.shippingRateId);
  // nothing physical in the cart (digital/service only) means nothing to ship
  const shipping = lines.some((l) => l.physical) ? ship.amount : 0;
  const { tax, total } = priceTotals({ subtotal, taxableSubtotal, taxRateBps, inclusive: market.taxInclusive, shipping });
  return { market, region, taxRateBps, lines, subtotal, tax, shipping, shippingRate: ship.rate, total };
}

storeRouter.post("/quote", async (req, res) => {
  const q = await priceCart(cartInput.parse(req.body));
  res.json({ currency: q.market.currency, taxInclusive: q.market.taxInclusive, taxRateBps: q.taxRateBps, region: q.region ?? null, lines: q.lines, subtotal: q.subtotal, tax: q.tax, shipping: q.shipping, total: q.total });
});

storeRouter.post("/checkout", async (req, res) => {
  const d = cartInput
    .extend({
      email: z.string().email(),
      name: z.string().min(1),
      phone: z.string().optional(),
      address: z.object({ line1: z.string(), line2: z.string().optional(), city: z.string(), region: z.string().optional(), postcode: z.string(), country: z.string().length(2) }),
    })
    .parse(req.body);
  const q = await priceCart({ ...d, region: d.address.region });
  if (q.market.regions.length && !q.region) throw bad("select your province/state");
  if (!JSON.parse(q.market.countries).includes(d.address.country)) throw bad(`${q.market.name} market does not ship to ${d.address.country}`);
  
  const order = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.upsert({
      where: { email: d.email },
      create: { email: d.email, name: d.name, phone: d.phone, tags: "[]", notes: "" },
      update: { name: d.name, phone: d.phone ?? undefined },
    });
    return tx.order.create({
      data: {
        number: await nextOrderNumber(tx),
        customerId: customer.id,
        marketId: q.market.id,
        currency: q.market.currency,
        subtotal: q.subtotal,
        tax: q.tax,
        shipping: q.shipping,
        total: q.total,
        shippingName: d.name,
        shippingAddress: JSON.stringify(d.address),
        tags: "[]",
        notes: "",
        items: { create: q.lines },
      },
    });
  });

  let session: Stripe.Checkout.Session;
  try {
    session = await createCheckoutSession({
      orderId: order.id,
      orderNumber: order.number,
      marketCode: q.market.code,
      currency: q.market.currency,
      taxInclusive: q.market.taxInclusive,
      taxRateBps: q.taxRateBps,
      lines: q.lines,
      tax: q.tax,
      discount: 0,
      shipping: q.shipping,
      shippingName: q.shippingRate?.name ?? "Shipping",
      email: d.email,
    });
  } catch (e) {
    // don't leave a pending order behind if Stripe rejects the session
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "failed", status: "cancelled" } });
    throw e;
  }
  await prisma.order.update({ where: { id: order.id }, data: { stripeSessionId: session.id } });
  res.json({ url: session.url, orderNumber: order.number });
});

// Mounted with raw body (see index.ts) so signature verification works.
export async function stripeWebhook(req: Request, res: Response) {
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(req.body, req.header("stripe-signature") ?? "", process.env.STRIPE_WEBHOOK_SECRET ?? "");
  } catch (e) {
    return void res.status(400).send(`webhook error: ${(e as Error).message}`);
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.expired") {
    const s = event.data.object as Stripe.Checkout.Session;
    const orderId = s.metadata?.orderId;
    if (orderId) {
      if (event.type === "checkout.session.expired") {
        // an expired payment link on a draft just clears the link; the draft stays editable
        await prisma.order.updateMany({ where: { id: orderId, status: "draft" }, data: { paymentLinkUrl: null, stripeSessionId: null } });
        await prisma.order.updateMany({ where: { id: orderId, paymentStatus: "pending", status: { not: "draft" } }, data: { paymentStatus: "failed", status: "cancelled" } });
      } else {
        // idempotent: only the first delivery flips pending -> paid and decrements stock
        const newlyPaid = await prisma.$transaction(async (tx) => {
          const flipped = await tx.order.updateMany({
            where: { id: orderId, paymentStatus: "pending" },
            data: { paymentStatus: "paid", paymentMethod: "stripe", stripePaymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : null },
          });
          if (!flipped.count) return false;
          await tx.order.updateMany({ where: { id: orderId, status: "draft" }, data: { status: "open" } });
          const items = await tx.orderItem.findMany({ where: { orderId } });
          for (const i of items) {
            if (!i.variantId) continue;
            const v = await tx.variant.findUnique({ where: { id: i.variantId }, include: { product: { select: { trackInventory: true } } } });
            if (v && shouldDecrement(v.product)) await tx.variant.update({ where: { id: i.variantId }, data: { inventory: { decrement: i.quantity } } });
          }
          return true;
        });
        // after the commit, and never allowed to fail the webhook (Stripe would retry and we'd double-process)
        if (newlyPaid) void sendOrderConfirmation(orderId);
      }
    }
  }
  if (event.type === "charge.refunded") {
    const pi = (event.data.object as Stripe.Charge).payment_intent;
    if (typeof pi === "string") await prisma.order.updateMany({ where: { stripePaymentIntentId: pi }, data: { paymentStatus: "refunded" } });
  }
  res.json({ received: true });
}

export const webhookBody = raw({ type: "application/json" });
