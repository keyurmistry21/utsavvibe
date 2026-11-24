import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { stripe } from "../stripe.js";
import { audit } from "../audit.js";
import { assertMarketAllowed } from "../auth.js";
import { settlePaidOrder } from "./store.js";

// Stripe Terminal: take card payments in person on a Stripe card reader (or Stripe's simulated reader in test mode).
// Flow: POS creates the pending in-store order -> /payment-intent -> the browser SDK collects the card -> /confirm marks it paid.
// Needs STRIPE_SECRET_KEY and, in the shop, a reader registered in the Stripe Dashboard. Not tested against live Stripe from this repo.
export const terminalRouter = Router();
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

const isTest = () => (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");

terminalRouter.get("/config", (_req, res) => res.json({ configured: !!process.env.STRIPE_SECRET_KEY, simulated: isTest() && !process.env.STRIPE_TERMINAL_LOCATION, locationId: process.env.STRIPE_TERMINAL_LOCATION ?? null }));

// Short-lived token the browser SDK uses to talk to the reader through Stripe.
terminalRouter.post("/connection-token", async (_req, res) => {
  const t = await stripe().terminal.connectionTokens.create();
  res.json({ secret: t.secret });
});

async function posOrder(id: string) {
  const o = await prisma.order.findFirst({ where: { id, channel: "in_store" }, include: { items: true, market: true } });
  if (!o) throw bad("not found", 404);
  return o;
}

// PaymentIntent for the card reader, amount and currency taken from our order (never from the browser).
terminalRouter.post("/payment-intent", async (req, res) => {
  const { orderId } = z.object({ orderId: z.string() }).parse(req.body);
  const o = await posOrder(orderId);
  await assertMarketAllowed(req, o.marketId);
  if (o.status !== "draft" || o.paymentStatus !== "pending") throw bad("This sale is not waiting for payment", 409);
  if (o.total < 50) throw bad("Card payments need at least 0.50");
  // card_present is what the Terminal SDK needs; the SDK's typings in this version don't list it, so the params go in untyped
  const params = { amount: o.total, currency: o.currency.toLowerCase(), payment_method_types: ["card_present"], capture_method: "automatic", description: `In-store order #${o.number}`, metadata: { orderId: o.id, channel: "terminal" } };
  const pi = await stripe().paymentIntents.create(params as never, { idempotencyKey: `terminal-pi-${o.id}-${o.total}` });
  await prisma.order.update({ where: { id: o.id }, data: { stripePaymentIntentId: pi.id, paymentMethod: "stripe" } });
  res.json({ clientSecret: pi.client_secret, amount: o.total, currency: o.currency });
});

// After the reader says it worked: check with Stripe (never trust the browser) and mark the order paid.
terminalRouter.post("/confirm", async (req, res) => {
  const { orderId } = z.object({ orderId: z.string() }).parse(req.body);
  const o = await posOrder(orderId);
  await assertMarketAllowed(req, o.marketId);
  if (o.paymentStatus === "paid") return void res.json({ paid: true, number: o.number });
  if (!o.stripePaymentIntentId) throw bad("No card payment was started for this sale", 409);
  const pi = await stripe().paymentIntents.retrieve(o.stripePaymentIntentId);
  if (pi.status !== "succeeded" || pi.amount_received !== o.total || pi.metadata?.orderId !== o.id) throw bad("Stripe has not confirmed this payment yet", 409);
  await settlePaidOrder(o.id, pi.id);
  await audit(req, "in_store_sale_terminal", `order #${o.number}`);
  res.json({ paid: true, number: o.number });
});

// Customer walked away or the card was declined: stop the reader payment and close the sale.
terminalRouter.post("/cancel", async (req, res) => {
  const { orderId } = z.object({ orderId: z.string() }).parse(req.body);
  const o = await posOrder(orderId);
  if (o.paymentStatus === "paid") throw bad("This sale is already paid", 409);
  if (o.stripePaymentIntentId) await stripe().paymentIntents.cancel(o.stripePaymentIntentId).catch(() => {});
  await prisma.order.update({ where: { id: o.id }, data: { status: "cancelled", paymentStatus: "failed" } });
  res.json({ ok: true });
});
