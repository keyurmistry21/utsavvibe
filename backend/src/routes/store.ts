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
import { loadPrefs } from "./onlineStore.js";
import { publicPolicy, publishedPolicies } from "./policies.js";
import { publicCollection, publicCollections } from "./collections.js";
import { publicPost, publicPosts } from "./blog.js";
import { issueForPaidOrder, releaseForOrder, reserve, splitPayment, usableCard } from "../giftCards.js";

// Public storefront API: catalog, quote, checkout. Plus Stripe webhook.
export const storeRouter = Router();

const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 });

storeRouter.get("/markets", async (_req, res) => {
  const markets = await prisma.market.findMany({ where: { active: true }, include: { shippingRates: true, regions: { orderBy: { name: "asc" } } } });
  res.json(markets.map((m) => ({ ...m, countries: parseJson<string[]>(m.countries, []) })));
});

// Store name, announcement, menus: one call for the storefront layout.
storeRouter.get("/site", async (_req, res) => res.json(await loadPrefs()));

// QR / barcode landing: SKU or barcode -> the product page (variant highlighted) in the requested market, else the first market selling it.
storeRouter.get("/lookup/:code", async (req, res) => {
  const code = req.params.code.trim().slice(0, 64);
  const v = code ? await prisma.variant.findFirst({ where: { OR: [{ sku: code }, { barcode: code }], product: { status: "active" } }, include: { product: { include: { markets: { include: { market: true } } } } } }) : null;
  const markets = v?.product.markets.map((m) => m.market).filter((m) => m.active) ?? [];
  const wanted = String(req.query.market ?? "").toUpperCase();
  const m = markets.find((x) => x.code === wanted) ?? markets[0];
  if (!v || !m) return void res.status(404).json({ error: "not found" });
  res.json({ market: m.code, handle: v.product.handle, variantId: v.id });
});

storeRouter.get("/policies", async (_req, res) => res.json(await publishedPolicies()));
storeRouter.get("/policies/:key", async (req, res) => {
  const p = await publicPolicy(req.params.key);
  if (!p) return void res.status(404).json({ error: "not found" });
  res.json(p);
});

storeRouter.get("/pages", async (_req, res) => {
  res.json(await prisma.page.findMany({ where: { visible: true }, orderBy: { title: "asc" }, select: { handle: true, title: true } }));
});

storeRouter.get("/pages/:handle", async (req, res) => {
  const p = await prisma.page.findFirst({ where: { handle: req.params.handle, visible: true }, select: { handle: true, title: true, content: true, seoTitle: true, seoDescription: true, updatedAt: true } });
  if (!p) return void res.status(404).json({ error: "not found" });
  res.json(p);
});

storeRouter.get("/collections", async (_req, res) => res.json(await publicCollections()));
storeRouter.get("/blog", async (_req, res) => res.json(await publicPosts()));
storeRouter.get("/blog/:handle", async (req, res) => {
  const p = await publicPost(req.params.handle);
  if (!p) return void res.status(404).json({ error: "not found" });
  res.json(p);
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

// A collection's products as the market sees them (active and sold there), in the collection's order.
storeRouter.get("/markets/:code/collections/:handle", async (req, res) => {
  const market = await prisma.market.findFirst({ where: { code: req.params.code, active: true } });
  const c = market && (await publicCollection(req.params.handle));
  if (!market || !c) return void res.status(404).json({ error: "not found" });
  const products = await prisma.product.findMany({
    where: { ...catalogQuery(market.id), id: { in: c.productIds } },
    include: { images: { orderBy: { position: "asc" } }, markets: { where: { marketId: market.id } }, variants: { include: { prices: { where: { marketId: market.id } } } } },
  });
  const order = new Map(c.productIds.map((id, i) => [id, i]));
  products.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  res.json({ ...c.collection, products: products.map((p) => publicProduct(p, market.currency)) });
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
  giftCardCode: z.string().trim().max(40).optional(),
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
      giftCard: v.product.isGiftCard,
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

// Gift card for this cart, or null. Gift cards can't pay for gift cards (keeps card-to-card laundering and fee dodging out).
async function giftCardFor(q: Awaited<ReturnType<typeof priceCart>>, code?: string) {
  if (!code) return null;
  if (q.lines.some((l) => l.giftCard)) throw bad("Gift cards can't be used to buy gift cards");
  const card = await usableCard(code, q.market.currency);
  return { card, ...splitPayment(card.balance, q.total, q.subtotal + (q.market.taxInclusive ? 0 : q.tax)) };
}

storeRouter.post("/quote", async (req, res) => {
  const d = cartInput.parse(req.body);
  const q = await priceCart(d);
  const gc = await giftCardFor(q, d.giftCardCode);
  res.json({ currency: q.market.currency, taxInclusive: q.market.taxInclusive, taxRateBps: q.taxRateBps, region: q.region ?? null, lines: q.lines, subtotal: q.subtotal, tax: q.tax, shipping: q.shipping, total: q.total, giftCardApplied: gc?.applied ?? 0, amountDue: q.total - (gc?.applied ?? 0), giftCardBalance: gc?.card.balance ?? null });
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
  const gc = await giftCardFor(q, d.giftCardCode);
  const applied = gc?.applied ?? 0;
  const covered = !!gc && applied === q.total; // (can only happen when shipping is free or the cart is items only) // the gift card pays everything: no Stripe session needed

  const order = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.upsert({
      where: { email: d.email },
      create: { email: d.email, name: d.name, phone: d.phone, tags: "[]", notes: "" },
      update: { name: d.name, phone: d.phone ?? undefined },
    });
    const o = await tx.order.create({
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
        ...(applied > 0 ? { giftCardCode: gc!.card.code, giftCardAmount: applied } : {}),
        ...(covered ? { paymentStatus: "paid", paymentMethod: "gift_card" } : {}),
      },
    });
    if (applied > 0) await reserve(tx, gc!.card.id, applied, o.id);
    if (covered) {
      for (const i of q.lines) {
        const v = await tx.variant.findUnique({ where: { id: i.variantId }, include: { product: { select: { trackInventory: true } } } });
        if (v && shouldDecrement(v.product)) await tx.variant.update({ where: { id: i.variantId }, data: { inventory: { decrement: i.quantity } } });
      }
    }
    return o;
  });
  if (covered) {
    void sendOrderConfirmation(order.id);
    return void res.json({ url: `${process.env.STOREFRONT_URL}/${q.market.code.toLowerCase()}/order/${order.number}`, orderNumber: order.number });
  }

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
      discount: applied,
      discountNote: applied ? "Gift card" : undefined,
      shipping: q.shipping,
      shippingName: q.shippingRate?.name ?? "Shipping",
      email: d.email,
    });
  } catch (e) {
    // don't leave a pending order behind if Stripe rejects the session, and give the gift card its money back
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "failed", status: "cancelled" } });
    await releaseForOrder(order.id);
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
        const expired = await prisma.order.updateMany({ where: { id: orderId, paymentStatus: "pending", status: { not: "draft" } }, data: { paymentStatus: "failed", status: "cancelled" } });
        if (expired.count) await releaseForOrder(orderId);
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
        if (newlyPaid) {
          void sendOrderConfirmation(orderId);
          void issueForPaidOrder(orderId);
        }
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
