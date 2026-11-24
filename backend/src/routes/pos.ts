import { Router } from "express";
import { z } from "zod";
import { prisma, nextOrderNumber } from "../db.js";
import { actor, assertMarketAllowed, scopeCodes, workingMarket } from "../auth.js";
import { priceTotals, taxRateFor } from "../money.js";
import { canSell } from "../stock.js";
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
  const locations = await prisma.location.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, region: true, isDefault: true } });
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
  variantId: z.string().min(1),
  marketId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
  locationId: z.string().optional(),
  name: z.string().trim().min(1, "Enter the customer's name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().max(40).optional(),
});

// Confirm the sale: pending order (price, tax and stock decided here, never by the phone) + one-off Stripe payment link.
posRouter.post("/sale", async (req, res) => {
  const d = saleInput.parse(req.body);
  const user = actor(req);
  const market = await prisma.market.findFirst({ where: { id: d.marketId, active: true }, include: { regions: true } });
  if (!market) throw bad("unknown market");
  await assertMarketAllowed(req, market.id);
  const v = await prisma.variant.findUnique({ where: { id: d.variantId }, include: { product: true, prices: { where: { marketId: market.id } }, levels: { where: { marketId: market.id } } } });
  if (!v || !v.qrActive || v.product.status !== "active") throw bad("This product is not on sale", 409);
  const unitPrice = v.prices[0]?.amount;
  if (unitPrice == null) throw bad(`"${v.product.title}" has no price in ${market.name}`);
  if (!canSell(v.product, v.levels[0]?.quantity ?? 0, d.quantity)) throw bad(`Only ${v.levels[0]?.quantity ?? 0} in stock`, 409);

  const location = d.locationId
    ? await prisma.location.findFirst({ where: { id: d.locationId, active: true } })
    : await prisma.location.findFirst({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });

  const email = d.email;
  const existing = await prisma.customer.findUnique({ where: { email } });
  const customer = existing ?? (await prisma.customer.create({ data: { email, name: d.name, phone: d.phone || null, tags: JSON.stringify(["in-store"]), notes: "" } }));

  const title = v.title === "Default" ? v.product.title : `${v.product.title} — ${v.title}`;
  const subtotal = unitPrice * d.quantity;
  const taxRateBps = taxRateFor(market, location?.region || undefined);
  const t = priceTotals({ exempt: customer.taxExempt, subtotal, taxableSubtotal: v.product.chargeTax ? subtotal : 0, discount: 0, taxRateBps, inclusive: market.taxInclusive, shipping: 0 });
  const address = { firstName: d.name, line1: location?.line1 ?? "", city: location?.city ?? "", region: location?.region ?? "", postcode: location?.postcode ?? "", country: location?.country ?? "", phone: d.phone ?? "" };

  const order = await prisma.order.create({
    data: {
      number: await nextOrderNumber(prisma),
      status: "draft",
      channel: "in_store",
      salespersonId: user.id,
      salespersonName: user.name || user.email,
      locationId: location?.id ?? null,
      locationName: location?.name ?? null,
      customerId: customer.id,
      marketId: market.id,
      currency: market.currency,
      subtotal,
      discount: 0,
      tax: t.tax,
      shipping: 0,
      total: t.total,
      shippingName: d.name,
      shippingAddress: JSON.stringify(address),
      paymentMethod: "stripe",
      notes: "",
      tags: JSON.stringify(["in-store"]),
      items: { create: [{ variantId: v.id, title, quantity: d.quantity, unitPrice, taxable: v.product.chargeTax, physical: v.product.physical, weightG: v.weightG }] },
    },
    include,
  });

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
      discount: 0,
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
