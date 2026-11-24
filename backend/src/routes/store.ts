import { Router, raw } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { prisma, parseJson, nextOrderNumber } from "../db.js";
import { pickShipping, priceTotals, taxRateFor } from "../money.js";
import { htmlToText } from "../html.js";
import { canSell, shouldDecrement, takeStock, onHand, reservedUnits } from "../stock.js";
import { stripe } from "../stripe.js";
import { createCheckoutSession } from "../checkout.js";
import { imageUrls } from "../storage.js";
import { sendOrderConfirmation } from "../orderEmails.js";
import { loadPrefs } from "./onlineStore.js";
import { publicPolicy, publishedPolicies } from "./policies.js";
import { publicCollection, publicCollections } from "./collections.js";
import { publicPost, publicPosts } from "./blog.js";
import { stripeTax, recordTax } from "../tax.js";
import { screenOrder, flag } from "../fraud.js";
import { emitOrder } from "../webhooks.js";
import { recoverCart, validUnsubscribe } from "../abandoned.js";
import { issueForPaidOrder, releaseForOrder, reserve, splitPayment, usableCard } from "../giftCards.js";

// Public storefront API: catalog, quote, checkout. Plus Stripe webhook.
export const storeRouter = Router();

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

storeRouter.get("/markets", async (_req, res) => {
  const markets = await prisma.market.findMany({ where: { active: true }, include: { shippingRates: true, regions: { orderBy: { name: "asc" } } } });
  res.json(markets.map((m) => ({ ...m, countries: parseJson<string[]>(m.countries, []) })));
});

// Store name, announcement, menus: one call for the storefront layout.
storeRouter.get("/site", async (_req, res) => res.json(await loadPrefs()));

// QR / barcode landing: SKU or barcode -> the product page (variant highlighted) in the requested market, else the first market selling it.
storeRouter.get("/lookup/:code", async (req, res) => {
  const code = req.params.code.trim().slice(0, 64);
  const v = code ? await prisma.variant.findFirst({ where: { OR: [{ sku: code }, { barcode: code }, { levels: { some: { OR: [{ sku: code }, { barcode: code }] } } }], qrActive: true, product: { status: "active" } }, include: { product: { include: { markets: { include: { market: true } } } } } }) : null;
  const markets = v?.product.markets.map((m) => m.market).filter((m) => m.active) ?? [];
  const wanted = String(req.query.market ?? "").toUpperCase();
  const m = markets.find((x) => x.code === wanted) ?? markets[0];
  if (!v || !m) return void res.status(404).json({ error: "not found" });
  res.json({ market: m.code, handle: v.product.handle, variantId: v.id });
});

// Visitor tracking beacon (doc §8): anonymous events, no IP or user agent stored. Bad input is dropped silently.
const trackInput = z.object({
  sid: z.string().regex(/^[a-z0-9]{8,40}$/i),
  type: z.enum(["page_view", "view_item", "add_to_cart", "begin_checkout", "purchase", "page_leave"]),
  path: z.string().max(300).startsWith("/"),
  title: z.string().max(190).default(""),
  market: z.string().max(8).default(""),
  source: z.string().max(100).default("direct"),
  medium: z.string().max(100).default(""),
  campaign: z.string().max(100).default(""),
  seconds: z.number().int().min(0).max(4 * 3600).optional(),
});
storeRouter.post("/track", async (req, res) => {
  const d = trackInput.safeParse(req.body);
  if (d.success) {
    const x = d.data;
    // keep the path only (query strings can carry emails or tokens)
    await prisma.trackEvent.create({ data: { sessionId: x.sid, type: x.type, path: x.path.split(/[?#]/)[0], title: x.title, market: x.market.toUpperCase(), source: x.source.toLowerCase(), medium: x.medium.toLowerCase(), campaign: x.campaign.toLowerCase(), durationSec: x.seconds ?? null } }).catch(() => {});
  }
  res.status(204).end();
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
  p: { trackInventory?: boolean; continueSelling?: boolean; seoTitle?: string; seoDescription?: string | null; images?: { id: string; alt: string }[]; markets?: { regions: string | null }[]; id: string; handle: string; title: string; description: string; tags: string; variants: { id: string; title: string; options: string; sku?: string | null; barcode?: string | null; inventory: number; prices: { amount: number; compareAt: number | null }[] }[] },
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
    sku: (v as { sku?: string | null }).sku ?? null,
    barcode: (v as { barcode?: string | null }).barcode ?? null,
    // scarcity note only when it's true and small
    stockLeft: (p.trackInventory ?? true) && !p.continueSelling && v.inventory > 0 && v.inventory <= 5 ? v.inventory : null,
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
  // when known, lets Stripe Tax (if switched on) work out the tax for the destination
  address: z.object({ country: z.string().length(2), postcode: z.string().max(20), line1: z.string().max(200).optional(), city: z.string().max(100).optional(), region: z.string().max(8).optional() }).optional(),
});

// 409 with a customer-friendly message for the first cart line that can't be fulfilled.
function stockProblem(stock: { title: string; available: number | null; ok: boolean }[]) {
  const s = stock.find((x) => !x.ok);
  if (s) throw bad(s.available ? `Only ${s.available} of ${s.title} available. Update your cart.` : `${s.title} is out of stock. Remove it from your cart.`, 409);
}

// Server-side pricing: never trust client prices.
async function priceCart(d: z.infer<typeof cartInput>) {
  const market = await prisma.market.findFirst({ where: { code: d.marketCode, active: true }, include: { shippingRates: true, regions: true } });
  if (!market) throw bad("unknown market");
  const region = d.region?.toUpperCase();
  if (region && market.regions.length && !market.regions.some((r) => r.code === region)) throw bad(`unknown region ${region}`);
  const lines = [];
  const stock: { variantId: string; title: string; requested: number; available: number | null; ok: boolean }[] = [];
  for (const it of d.items) {
    const v = await prisma.variant.findUnique({
      where: { id: it.variantId },
      include: { product: { include: { markets: true } }, prices: { where: { marketId: market.id } } },
    });
    if (!v || v.product.status !== "active" || !v.product.markets.some((m) => m.marketId === market.id) || !v.prices[0])
      throw bad(`item not available in ${market.name}`);
    const sold = parseJson<string[]>(v.product.markets.find((m) => m.marketId === market.id)?.regions ?? "[]", []);
    if (region && sold.length && !sold.includes(region)) throw bad(`${v.product.title} is not available in ${market.regions.find((r) => r.code === region)?.name ?? region}`);
    // never throws: the cart shows "Out of stock" / "Only X available" and checkout re-checks under a lock
    const have = await onHand(prisma, v.id, market.id);
    const unlimited = !v.product.trackInventory || v.product.continueSelling;
    stock.push({ variantId: v.id, title: v.title === "Default" ? v.product.title : `${v.product.title} — ${v.title}`, requested: it.quantity, available: unlimited ? null : Math.max(0, have), ok: canSell(v.product, have, it.quantity) });
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
  let { tax, total } = priceTotals({ subtotal, taxableSubtotal, taxRateBps, inclusive: market.taxInclusive, shipping });
  let taxCalcId: string | null = null;
  if (d.address && JSON.parse(market.countries).includes(d.address.country.toUpperCase())) {
    const st = await stripeTax({ currency: market.currency, inclusive: market.taxInclusive, lines, shipping, address: { ...d.address, country: d.address.country.toUpperCase(), region: d.address.region ?? region } });
    if (st) {
      tax = st.tax;
      taxCalcId = st.id;
      total = subtotal + shipping + (market.taxInclusive ? 0 : tax);
    }
  }
  const freeOver = ship.rate?.freeOverAmount ?? null;
  const freeShippingRemaining = freeOver != null && lines.some((l) => l.physical) && subtotal < freeOver ? freeOver - subtotal : null;
  return { market, region, taxRateBps, lines, stock, subtotal, tax, shipping, shippingRate: ship.rate, total, taxCalcId, freeShippingRemaining };
}

// Gift card for this cart, or null. Gift cards can't pay for gift cards (keeps card-to-card laundering and fee dodging out).
const codeMisses = new Map<string, { n: number; until: number }>();
async function giftCardFor(q: Awaited<ReturnType<typeof priceCart>>, code?: string, ip = "?") {
  if (!code) return null;
  const m = codeMisses.get(ip);
  if (m && m.until > Date.now() && m.n >= 8) throw Object.assign(new Error("Too many wrong gift card codes. Try again in 15 minutes."), { status: 429 });
  if (q.lines.some((l) => l.giftCard)) throw bad("Gift cards can't be used to buy gift cards");
  const card = await usableCard(code, q.market.currency).catch((e) => {
    const cur = codeMisses.get(ip);
    codeMisses.set(ip, { n: (cur && cur.until > Date.now() ? cur.n : 0) + 1, until: cur && cur.until > Date.now() ? cur.until : Date.now() + 15 * 60_000 });
    throw e;
  });
  return { card, ...splitPayment(card.balance, q.total, q.subtotal + (q.market.taxInclusive ? 0 : q.tax)) };
}

storeRouter.post("/quote", async (req, res) => {
  const d = cartInput.parse(req.body);
  const q = await priceCart(d);
  const gc = await giftCardFor(q, d.giftCardCode, req.ip);
  res.json({ stock: q.stock, currency: q.market.currency, taxInclusive: q.market.taxInclusive, taxRateBps: q.taxRateBps, region: q.region ?? null, taxSource: q.taxCalcId ? "stripe" : "market", freeShippingRemaining: q.freeShippingRemaining, lines: q.lines, subtotal: q.subtotal, tax: q.tax, shipping: q.shipping, total: q.total, giftCardApplied: gc?.applied ?? 0, amountDue: q.total - (gc?.applied ?? 0), giftCardBalance: gc?.card.balance ?? null });
});

storeRouter.post("/checkout", async (req, res) => {
  const d = cartInput
    .extend({
      email: z.string().email(),
      name: z.string().min(1),
      phone: z.string().optional(),
      marketing: z.boolean().optional(), // ticked "email me reminders"
      address: z.object({ line1: z.string(), line2: z.string().optional(), city: z.string(), region: z.string().optional(), postcode: z.string(), country: z.string().length(2) }),
    })
    .parse(req.body);
  const q = await priceCart({ ...d, region: d.address.region });
  stockProblem(q.stock); // stop before any order or payment exists
  if (q.market.regions.length && !q.region) throw bad("select your province/state");
  if (!JSON.parse(q.market.countries).includes(d.address.country)) throw bad(`${q.market.name} market does not ship to ${d.address.country}`);
  // card-testing / spam guard: a few unpaid checkouts per email per hour is plenty
  const stuck = await prisma.order.count({ where: { customer: { email: d.email }, paymentStatus: "pending", status: "open", createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (stuck >= 5) throw Object.assign(new Error("Too many unfinished checkouts for this email. Please finish one, or try again later."), { status: 429 });
  const gc = await giftCardFor(q, d.giftCardCode, req.ip);
  const applied = gc?.applied ?? 0;
  const covered = !!gc && applied === q.total; // (can only happen when shipping is free or the cart is items only) // the gift card pays everything: no Stripe session needed

  const order = await prisma.$transaction(async (tx) => {
    // Last-unit protection: lock the variants, then count on-hand minus what other unpaid checkouts hold. Two buyers of the
    // last unit queue on the lock; the second sees it reserved and is turned away before any payment is created.
    const ids = [...new Set(q.lines.map((l) => l.variantId))].sort();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM Variant WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    for (const l of q.lines) {
      const v = await tx.variant.findUnique({ where: { id: l.variantId }, include: { product: { select: { trackInventory: true, continueSelling: true, title: true } } } });
      if (!v) throw bad("item no longer available", 409);
      const free = (await onHand(tx, v.id, q.market.id)) - (await reservedUnits(tx, v.id, q.market.id));
      if (!canSell(v.product, free, l.quantity)) throw bad(free > 0 ? `Only ${free} of ${l.title} available right now. Update your cart.` : `${l.title} is out of stock. Remove it from your cart.`, 409);
    }
    const customer = await tx.customer.upsert({
      where: { email: d.email },
      create: { email: d.email, name: d.name, phone: d.phone, tags: "[]", notes: "", acceptsEmail: !!d.marketing },
      update: { name: d.name, phone: d.phone ?? undefined, ...(d.marketing ? { acceptsEmail: true } : {}) },
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
        taxCalcId: q.taxCalcId,
        ...(applied > 0 ? { giftCardCode: gc!.card.code, giftCardAmount: applied } : {}),
        ...(covered ? { paymentStatus: "paid", paymentMethod: "gift_card" } : {}),
      },
    });
    if (applied > 0) await reserve(tx, gc!.card.id, applied, o.id);
    if (covered) {
      for (const i of q.lines) {
        const v = await tx.variant.findUnique({ where: { id: i.variantId }, include: { product: { select: { trackInventory: true } } } });
        if (v && shouldDecrement(v.product)) await takeStock(tx, i.variantId, i.quantity, o.marketId);
      }
    }
    return o;
  });
  if (covered) {
    void sendOrderConfirmation(order.id);
    void recordTax(q.taxCalcId, order.number);
    void emitOrder("order.paid", order.id);
    void screenOrder(order.id, null);
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
        const conflicts: string[] = [];
        const newlyPaid = await prisma.$transaction(async (tx) => {
          const flipped = await tx.order.updateMany({
            where: { id: orderId, paymentStatus: "pending" },
            data: { paymentStatus: "paid", paymentMethod: "stripe", stripePaymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : null },
          });
          if (!flipped.count) return false;
          await tx.order.updateMany({ where: { id: orderId, status: "draft" }, data: { status: "open" } });
          const items = await tx.orderItem.findMany({ where: { orderId } });
          const paidOrder = await tx.order.findUnique({ where: { id: orderId }, select: { marketId: true } });
          for (const i of items) {
            if (!i.variantId) continue;
            const v = await tx.variant.findUnique({ where: { id: i.variantId }, include: { product: { select: { trackInventory: true, continueSelling: true } } } });
            if (v && shouldDecrement(v.product)) {
              // last-resort check: payment arrived but the units are gone (e.g. checkout older than the reservation window)
              if (paidOrder && !v.product.continueSelling && (await onHand(tx, i.variantId, paidOrder.marketId)) < i.quantity) conflicts.push(i.title);
              await takeStock(tx, i.variantId, i.quantity, paidOrder?.marketId);
            }
          }
          return true;
        });
        if (newlyPaid && conflicts.length) {
          const o = await prisma.order.findUnique({ where: { id: orderId }, select: { tags: true, notes: true } });
          const tags = new Set<string>(parseJson<string[]>(o?.tags ?? "[]", [])); tags.add("stock-conflict");
          await prisma.order.update({ where: { id: orderId }, data: { tags: JSON.stringify([...tags]), notes: `${o?.notes ? o.notes + "\n" : ""}Oversold: paid, but not enough stock for ${conflicts.join(", ")}. Restock, or refund the customer.` } });
        }
        // after the commit, and never allowed to fail the webhook (Stripe would retry and we'd double-process)
        if (newlyPaid) {
          void sendOrderConfirmation(orderId);
          void issueForPaidOrder(orderId);
          void emitOrder("order.paid", orderId);
          void afterPaid(orderId, typeof s.payment_intent === "string" ? s.payment_intent : null);
        }
      }
    }
  }
  if (event.type === "charge.refunded") {
    const pi = (event.data.object as Stripe.Charge).payment_intent;
    if (typeof pi === "string") {
      await prisma.order.updateMany({ where: { stripePaymentIntentId: pi }, data: { paymentStatus: "refunded" } });
      const o = await prisma.order.findFirst({ where: { stripePaymentIntentId: pi } });
      if (o) void emitOrder("order.refunded", o.id);
    }
  }
  // Disputes, early fraud warnings and Radar reviews raise the order's risk so staff see it on the order.
  const chargeOrder = async (chargeId: unknown) => {
    if (typeof chargeId !== "string") return null;
    const ch = await stripe().charges.retrieve(chargeId);
    return typeof ch.payment_intent === "string" ? prisma.order.findFirst({ where: { stripePaymentIntentId: ch.payment_intent } }) : null;
  };
  if (event.type === "charge.dispute.created") {
    const o = await chargeOrder((event.data.object as Stripe.Dispute).charge);
    if (o) await flag(o.id, "high", "Customer opened a payment dispute (chargeback). Respond with evidence in the Stripe Dashboard before the deadline");
  }
  if (event.type === "radar.early_fraud_warning.created") {
    const o = await chargeOrder((event.data.object as Stripe.Radar.EarlyFraudWarning).charge);
    if (o) await flag(o.id, "high", "The card network reported this payment as fraud (early fraud warning). Consider refunding to avoid a dispute fee");
  }
  if (event.type === "review.opened") {
    const o = await prisma.order.findFirst({ where: { stripePaymentIntentId: typeof (event.data.object as Stripe.Review).payment_intent === "string" ? ((event.data.object as Stripe.Review).payment_intent as string) : "-" } });
    if (o) await flag(o.id, "medium", "Stripe Radar opened a manual review");
  }
  res.json({ received: true });
}

export const webhookBody = raw({ type: "application/json" });


// After the order is paid: screen for fraud and record the sale with Stripe Tax. Never throws.
async function afterPaid(orderId: string, paymentIntentId: string | null) {
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  if (!o) return;
  await screenOrder(orderId, paymentIntentId);
  await recordTax(o.taxCalcId, o.number);
}

// Cart reminder link: returns the items so the cart can be refilled. Only while the order is unpaid; the token is 256-bit random.
storeRouter.get("/recover/:token", async (req, res) => {
  const c = await recoverCart(req.params.token);
  if (!c) return void res.status(404).json({ error: "This cart link has expired" });
  res.json(c);
});

// Unsubscribe from cart reminders. GET = link in the email, POST = one-click from the mail app (List-Unsubscribe-Post).
const unsubscribe = async (req: Request, res: Response) => {
  const c = String(req.query.c ?? ""), t = String(req.query.t ?? "");
  if (!c || !validUnsubscribe(c, t)) return void res.status(400).type("html").send("<p>This unsubscribe link is not valid.</p>");
  await prisma.customer.updateMany({ where: { id: c }, data: { acceptsEmail: false } });
  res.type("html").send(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><body style="font-family:system-ui;max-width:480px;margin:15vh auto;padding:0 20px"><h2>You're unsubscribed</h2><p>We won't send you cart reminders any more. Order confirmations still arrive when you buy something.</p>`);
};
storeRouter.get("/unsubscribe", unsubscribe);
storeRouter.post("/unsubscribe", unsubscribe);
