import { Router } from "express";
import { z } from "zod";
import { prisma, nextOrderNumber } from "../db.js";
import { actor, assertMarketAllowed, assertLocationAllowed, scopeCodes, scopeLocations, workingMarket } from "../auth.js";
import { priceTotals, taxRateFor, taxBreakdownFor } from "../money.js";
import { canSell, takeStock, allocateSale } from "../stock.js";
import { sendOrderConfirmation } from "../orderEmails.js";
import { alertLowStock } from "../lowStock.js";
import { createCheckoutSession } from "../checkout.js";
import { stripe } from "../stripe.js";
import { audit } from "../audit.js";

// In-store sales: a signed-in salesperson scans a product QR, confirms the customer, and shows a one-off payment QR.
// The product QR itself only opens a public product page; nothing here is reachable without a staff session.
export const posRouter = Router();

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const PAY_WINDOW_MIN = 60; // payment QR stays valid this long (Stripe minimum is 30)

const include = { items: true, customer: true, market: true } as const;

// Product for a scanned code (SKU, barcode or a /p/<code> link): name, image, size, SKU, price and stock in the staff member's market.
posRouter.get("/lookup", async (req, res) => {
  const raw = String(req.query.code ?? "").trim().slice(0, 300);
  const m = raw.match(/\/p\/([^/?#]+)/);
  const code = (m ? decodeURIComponent(m[1]) : raw).slice(0, 64);
  if (!code) throw bad("Scan a product code");
  const own = await prisma.inventoryLevel.findFirst({ where: { OR: [{ sku: code }, { barcode: code }] }, include: { market: true } });
  const v = await prisma.variant.findFirst({
    where: own ? { id: own.variantId } : { OR: [{ sku: code }, { barcode: code }] },
    include: { product: { include: { images: { orderBy: { position: "asc" }, take: 1 } } }, levels: true },
  });
  if (!v) throw bad(`No product with the code "${code}"`, 404);
  if (!v.qrActive) throw bad("This product's QR code has been switched off. Ask an admin.", 410);
  if (v.product.status !== "active") throw bad("This product is not on sale", 409);

  const allowed = scopeCodes(req);
  const wanted = own?.market.code ?? (String(req.query.market ?? "").toUpperCase() || workingMarket(actor(req)) || "");
  const pm = await prisma.productMarket.findMany({ where: { productId: v.productId }, include: { market: true } });
  const sellable = pm.map((x) => x.market).filter((x) => x.active && (!allowed || allowed.includes(x.code)));
  const market = sellable.find((x) => x.code === wanted) ?? sellable[0];
  if (!market) throw bad("This product isn't sold in a market you can work in", 403);
  const price = await prisma.variantPrice.findUnique({ where: { variantId_marketId: { variantId: v.id, marketId: market.id } } });
  const level = v.levels.find((l) => l.marketId === market.id);
  const locScope = scopeLocations(req);
  const locations = await prisma.location.findMany({ where: { active: true, ...(locScope ? { id: { in: locScope } } : {}) }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, region: true, isDefault: true } });
  let options: Record<string, string> = {};
  try { options = JSON.parse(v.options); } catch { /* keep empty */ }
  res.json({
    variantId: v.id,
    productId: v.productId,
    title: v.product.title,
    variant: v.title === "Default" ? "" : v.title,
    options,
    sku: level?.sku || v.sku,
    imageId: v.product.images[0]?.id ?? null,
    market: { id: market.id, code: market.code, currency: market.currency, name: market.name, taxInclusive: market.taxInclusive },
    price: price?.amount ?? null,
    stock: level?.quantity ?? 0,
    tracked: v.product.trackInventory,
    canSell: price != null && canSell(v.product, level?.quantity ?? 0, 1),
    locations,
  });
});

const saleInput = z.object({
  marketId: z.string().min(1),
  items: z.array(z.object({ variantId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).min(1, "Add at least one item").max(30),
  locationId: z.string().optional(),
  name: z.string().trim().min(1, "Enter the customer's name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().max(40).optional(),
  discount: z.number().int().min(0).default(0), // minor units off the items, set by the salesperson
  discountNote: z.string().trim().max(120).optional(),
  clientRef: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/).optional(), // set by an offline till; the same ref is never sold twice
  payWith: z.enum(["card", "cash", "terminal"]).default("card"), // card = Stripe payment QR; cash = taken at the counter, order closes at once
});

// Confirm the sale: price, tax and stock are decided here, never by the phone.
// card -> pending order + one-off Stripe payment link; cash -> paid and handed over immediately.
posRouter.post("/sale", async (req, res) => {
  const d = saleInput.parse(req.body);
  const user = actor(req);
  if (d.clientRef) {
    // already synced (the till retried after a dropped connection): answer with the order that exists
    const done = await prisma.order.findUnique({ where: { clientRef: d.clientRef } });
    if (done) return void res.status(200).json({ orderId: done.id, number: done.number, paid: done.paymentStatus === "paid", total: done.total, currency: done.currency, duplicate: true });
  }
  const market = await prisma.market.findFirst({ where: { id: d.marketId, active: true }, include: { regions: true } });
  if (!market) throw bad("unknown market");
  await assertMarketAllowed(req, market.id);

  // merge repeated scans of the same variant, then price every line from the database
  const want = new Map<string, number>();
  for (const it of d.items) want.set(it.variantId, (want.get(it.variantId) ?? 0) + it.quantity);
  const lines: { variantId: string; title: string; quantity: number; unitPrice: number; taxable: boolean; physical: boolean; weightG: number; track: boolean }[] = [];
  for (const [variantId, quantity] of want) {
    const v = await prisma.variant.findUnique({ where: { id: variantId }, include: { product: true, prices: { where: { marketId: market.id } }, levels: { where: { marketId: market.id } } } });
    if (!v || !v.qrActive || v.product.status !== "active") throw bad("An item in the basket is not on sale any more", 409);
    const unitPrice = v.prices[0]?.amount;
    const title = v.title === "Default" ? v.product.title : `${v.product.title} — ${v.title}`;
    if (unitPrice == null) throw bad(`"${title}" has no price in ${market.name}`);
    const have = v.levels[0]?.quantity ?? v.inventory;
    if (!canSell(v.product, have, quantity)) throw bad(`Only ${Math.max(0, have)} of ${title} in stock`, 409);
    lines.push({ variantId, title, quantity, unitPrice, taxable: v.product.chargeTax, physical: v.product.physical, weightG: v.weightG, track: v.product.trackInventory });
  }

  if (d.locationId) assertLocationAllowed(req, d.locationId);
  const locScope = scopeLocations(req);
  const location = d.locationId
    ? await prisma.location.findFirst({ where: { id: d.locationId, active: true } })
    : await prisma.location.findFirst({ where: { active: true, ...(locScope ? { id: { in: locScope } } : {}) }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });

  const email = d.email;
  const existing = await prisma.customer.findUnique({ where: { email } });
  const customer = existing ?? (await prisma.customer.create({ data: { email, name: d.name, phone: d.phone || null, tags: JSON.stringify(["in-store"]), notes: "" } }));

  const subtotal = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  const taxableSubtotal = lines.filter((l) => l.taxable).reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  if (d.discount > subtotal) throw bad("The discount is more than the items cost");
  const taxRateBps = taxRateFor(market, location?.region || undefined);
  const t = priceTotals({ exempt: customer.taxExempt, subtotal, taxableSubtotal, discount: d.discount, taxRateBps, inclusive: market.taxInclusive, shipping: 0 });
  const address = { firstName: d.name, line1: location?.line1 ?? "", city: location?.city ?? "", region: location?.region ?? "", postcode: location?.postcode ?? "", country: location?.country ?? "", phone: d.phone ?? "" };
  const cash = d.payWith === "cash";

  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({
      data: {
        number: await nextOrderNumber(tx),
        status: cash ? "fulfilled" : "draft",
        ...(cash ? { paymentStatus: "paid", shippedAt: new Date() } : {}),
        channel: "in_store",
        ...(d.clientRef ? { clientRef: d.clientRef } : {}),
        salespersonId: user.id,
        salespersonName: user.name || user.email,
        locationId: location?.id ?? null,
        locationName: location?.name ?? null,
        customerId: customer.id,
        marketId: market.id,
        currency: market.currency,
        subtotal,
        discount: t.discount,
        discountNote: d.discount > 0 ? d.discountNote || "In-store discount" : null,
        tax: t.tax,
        taxBreakdown: taxBreakdownFor(market, location?.region || undefined, t.tax),
        shipping: 0,
        total: t.total,
        shippingName: d.name,
        shippingAddress: JSON.stringify(address),
        paymentMethod: cash ? "cash" : "stripe",
        notes: "",
        tags: JSON.stringify(["in-store"]),
        items: { create: lines.map(({ track, ...l }) => l) },
      },
      include,
    });
    if (cash) {
      // take the stock under a row lock so two counters can't sell the same last unit
      for (const l of lines) {
        await tx.$queryRaw`SELECT id FROM Variant WHERE id = ${l.variantId} FOR UPDATE`;
        if (l.track) {
          const v = await tx.variant.findUnique({ where: { id: l.variantId }, include: { product: { select: { continueSelling: true } }, levels: { where: { marketId: market.id } } } });
          const have = v?.levels[0]?.quantity ?? v?.inventory ?? 0;
          if (!v?.product.continueSelling && have < l.quantity) throw bad(`Only ${Math.max(0, have)} of ${l.title} in stock`, 409);
          await takeStock(tx, l.variantId, l.quantity, market.id);
          await allocateSale(tx, l.variantId, l.quantity, market.id, location?.id);
        }
      }
    }
    return o;
  });

  if (cash) {
    void sendOrderConfirmation(order.id);
    void alertLowStock(lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), market.id);
    await audit(req, "in_store_sale_cash", `order #${order.number}`);
    return void res.status(201).json({ orderId: order.id, number: order.number, paid: true, total: order.total, currency: order.currency });
  }

  if (d.payWith === "terminal") {
    // the card reader takes the payment: the browser asks /terminal/payment-intent next
    await audit(req, "in_store_sale_created", `order #${order.number} (card reader)`);
    return void res.status(201).json({ orderId: order.id, number: order.number, terminal: true, total: order.total, currency: order.currency });
  }

  try {
    const session = await createCheckoutSession({
      orderId: order.id,
      orderNumber: order.number,
      marketCode: market.code,
      currency: market.currency,
      taxInclusive: market.taxInclusive,
      taxRateBps,
      lines: order.items,
      tax: order.tax,
      discount: order.discount,
      discountNote: order.discountNote,
      shipping: 0,
      shippingName: "In-store pickup",
      email,
      expiresInHours: PAY_WINDOW_MIN / 60,
    });
    await prisma.order.update({ where: { id: order.id }, data: { paymentLinkUrl: session.url, stripeSessionId: session.id } });
    await audit(req, "in_store_sale_created", `order #${order.number}`);
    res.status(201).json({ orderId: order.id, number: order.number, url: session.url, total: order.total, currency: order.currency, expiresInMinutes: PAY_WINDOW_MIN });
  } catch (e) {
    await prisma.order.update({ where: { id: order.id }, data: { status: "cancelled", paymentStatus: "failed" } });
    throw e;
  }
});

// Only the salesperson's own in-store orders (owners and order managers see all) can be polled or cancelled from here.
async function mine(req: Parameters<typeof actor>[0], id: string) {
  const o = await prisma.order.findFirst({ where: { id, channel: "in_store" }, include });
  if (!o) throw bad("not found", 404);
  const scope = scopeCodes(req);
  if (scope && !scope.includes(o.market.code)) throw bad("not found", 404);
  return o;
}

// The salesperson's screen polls this until the Stripe webhook has marked the order paid.
posRouter.get("/sale/:id", async (req, res) => {
  const o = await mine(req, req.params.id);
  res.json({ number: o.number, status: o.status, paymentStatus: o.paymentStatus, total: o.total, currency: o.currency, url: o.paymentLinkUrl });
});

// Customer changed their mind: close the payment link and the pending order.
posRouter.post("/sale/:id/cancel", async (req, res) => {
  const o = await mine(req, req.params.id);
  if (o.status !== "draft" || o.paymentStatus === "paid") throw bad("This sale can no longer be cancelled", 409);
  if (o.stripeSessionId) await stripe().checkout.sessions.expire(o.stripeSessionId).catch(() => {});
  await prisma.order.update({ where: { id: o.id }, data: { status: "cancelled", paymentLinkUrl: null } });
  await audit(req, "in_store_sale_cancelled", `order #${o.number}`);
  res.json({ ok: true });
});

// Everything a till needs to sell cash while offline: every sellable variant with its code, price and stock in the staff member's market.
posRouter.get("/catalog", async (req, res) => {
  const allowed = scopeCodes(req);
  const code = String(req.query.market ?? "").toUpperCase() || workingMarket(actor(req)) || "";
  const market = await prisma.market.findFirst({ where: { active: true, ...(code ? { code } : {}), ...(allowed ? { code: code && allowed.includes(code) ? code : { in: allowed } } : {}) }, orderBy: { code: "asc" } });
  if (!market) throw bad("Choose a market first", 403);
  const variants = await prisma.variant.findMany({
    where: { qrActive: true, product: { status: "active", markets: { some: { marketId: market.id } } }, prices: { some: { marketId: market.id } } },
    include: { product: { include: { images: { orderBy: { position: "asc" }, take: 1 } } }, prices: { where: { marketId: market.id } }, levels: { where: { marketId: market.id } } },
    take: 3000,
  });
  const locScope = scopeLocations(req);
  const locations = await prisma.location.findMany({ where: { active: true, ...(locScope ? { id: { in: locScope } } : {}) }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } });
  res.json({
    savedAt: new Date().toISOString(),
    market: { id: market.id, code: market.code, currency: market.currency, name: market.name, taxInclusive: market.taxInclusive },
    locations,
    items: variants.map((v) => {
      const lv = v.levels[0];
      let options: Record<string, string> = {};
      try { options = JSON.parse(v.options); } catch { /* none */ }
      const have = lv?.quantity ?? v.inventory;
      return { variantId: v.id, title: v.product.title, variant: v.title === "Default" ? "" : v.title, options, sku: lv?.sku || v.sku, codes: [v.sku, v.barcode, lv?.sku, lv?.barcode].filter(Boolean), imageId: v.product.images[0]?.id ?? null, price: v.prices[0].amount, stock: have, tracked: v.product.trackInventory, canSell: canSell(v.product, have, 1) };
    }),
  });
});
