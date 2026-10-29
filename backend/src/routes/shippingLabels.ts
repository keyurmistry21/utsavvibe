import { Router } from "express";
import { orderScopeParam } from "../auth.js";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { buyLabel, getRates, shippoConfigured, voidLabel, type Addr, type Customs } from "../shippo.js";
import { shipFromAddress } from "./locations.js";

// Buy / void carrier postage for an order (mounted under /api/admin/orders, needs orders.manage).
// Buying costs real money, so it only happens on an explicit POST /buy for a rate staff just saw, never automatically.
export const shippingLabelsRouter = Router();
shippingLabelsRouter.param("id", orderScopeParam);

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

async function load(id: string) {
  const o = await prisma.order.findUnique({ where: { id }, include: { items: true, customer: true } });
  if (!o) throw bad("order not found", 404);
  if (o.status === "draft" || o.status === "cancelled") throw bad("Postage can only be bought for open or fulfilled orders", 409);
  if (o.paymentStatus !== "paid") throw bad("The order isn't paid yet", 409);
  if (!o.items.some((i) => i.physical)) throw bad("This order has nothing to ship", 409);
  return o;
}

async function addresses(o: Awaited<ReturnType<typeof load>>) {
  const f = await shipFromAddress();
  if (!f.line1 || !f.city || !f.postcode || !f.country) throw bad("Add your ship-from address under Settings → Locations first");
  const a = parseJson<Record<string, string>>(o.shippingAddress, {});
  if (!a.line1 || !a.city || !a.country) throw bad("This order has no complete shipping address");
  const from: Addr = { name: f.name || f.company || "Sender", company: f.company || undefined, street1: f.line1, street2: f.line2 || undefined, city: f.city, state: f.region || undefined, zip: f.postcode, country: f.country, phone: f.phone || undefined };
  const to: Addr = { name: o.shippingName || o.customer?.name || "Customer", street1: a.line1, street2: a.line2 || undefined, city: a.city, state: a.region || undefined, zip: a.postcode ?? "", country: a.country, phone: o.customer?.phone || undefined, email: o.customer?.email || undefined };
  return { from, to };
}

const parcelInput = z.object({
  lengthCm: z.number().min(1).max(300), widthCm: z.number().min(1).max(300), heightCm: z.number().min(1).max(300),
  weightG: z.number().int().min(1).max(70_000),
});
const parcel = (p: z.infer<typeof parcelInput>) => ({ length: p.lengthCm, width: p.widthCm, height: p.heightCm, distance_unit: "cm" as const, weight: p.weightG, mass_unit: "g" as const });

// Other country than the sender's means customs paperwork.
function customsFor(o: Awaited<ReturnType<typeof load>>, from: Addr, to: Addr, signer: string): Customs | undefined {
  if (from.country === to.country) return undefined;
  return { signer, items: o.items.filter((i) => i.physical).map((i) => ({ description: i.title, quantity: i.quantity, weightG: i.weightG || 100, value: i.unitPrice, currency: o.currency, originCountry: from.country })) };
}

shippingLabelsRouter.get("/:id/shipping", async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: req.params.id }, select: { labelUrl: true, labelId: true, labelCost: true, labelCurrency: true } });
  if (!o) return void res.status(404).json({ error: "not found" });
  res.json({ configured: shippoConfigured(), label: o.labelId ? { url: o.labelUrl, cost: o.labelCost, currency: o.labelCurrency } : null });
});

shippingLabelsRouter.post("/:id/shipping/rates", async (req, res) => {
  const d = z.object({ parcel: parcelInput }).parse(req.body);
  const o = await load(req.params.id);
  if (o.labelId) throw bad("A label was already bought for this order. Void it first to buy another.", 409);
  const { from, to } = await addresses(o);
  const rates = await getRates({ from, to, parcel: parcel(d.parcel), customs: customsFor(o, from, to, from.name) });
  res.json({ rates, international: from.country !== to.country });
});

shippingLabelsRouter.post("/:id/shipping/buy", async (req, res) => {
  const d = z.object({ rateId: z.string().min(1).max(100) }).parse(req.body);
  const o = await load(req.params.id);
  // claim the order first so a double click can't buy two labels
  const claim = await prisma.order.updateMany({ where: { id: o.id, labelId: null }, data: { labelId: "buying" } });
  if (!claim.count) throw bad("A label was already bought for this order. Void it first to buy another.", 409);
  try {
    const l = await buyLabel(d.rateId);
    await prisma.order.update({ where: { id: o.id }, data: { labelId: l.id, labelUrl: l.labelUrl, labelCost: l.cost, labelCurrency: l.currency, carrier: l.carrier, trackingNumber: l.trackingNumber || null, trackingUrl: l.trackingUrl } });
    res.json({ labelUrl: l.labelUrl, cost: l.cost, currency: l.currency, carrier: l.carrier, trackingNumber: l.trackingNumber });
  } catch (e) {
    await prisma.order.updateMany({ where: { id: o.id, labelId: "buying" }, data: { labelId: null } });
    throw e;
  }
});

shippingLabelsRouter.post("/:id/shipping/void", async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!o) throw bad("order not found", 404);
  if (!o.labelId || o.labelId === "buying") throw bad("There is no label to void", 409);
  await voidLabel(o.labelId); // the carrier refunds the postage to the Shippo account
  await prisma.order.update({ where: { id: o.id }, data: { labelId: null, labelUrl: null, labelCost: null, labelCurrency: null, trackingNumber: null, trackingUrl: null, carrier: null } });
  res.json({ ok: true });
});
