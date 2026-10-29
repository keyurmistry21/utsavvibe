import type Stripe from "stripe";
import { prisma } from "./db.js";
import { getSetting } from "./appSettings.js";
import { stripe } from "./stripe.js";
import { sendMail, storeName } from "./mail.js";
import { esc } from "./emails.js";
import { emitOrder } from "./webhooks.js";

type Level = "low" | "medium" | "high";

// Fraud screening after payment. Stripe Radar (included with Stripe) decides about the card itself; we add store-side checks
// Radar can't know: first-time buyer with a large order, shipping country differs from the card's, many orders in an hour.
// Flags only: staff decide. High risk orders are tagged, shown with a red banner, and the owners get an email.
export async function screenOrder(orderId: string, paymentIntentId: string | null) {
  try {
    const o = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
    if (!o || o.riskLevel) return;
    const reasons: string[] = [];
    let score = 0;
    const add = (pts: number, why: string) => ((score += pts), reasons.push(why));

    if (paymentIntentId) {
      const pi = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
      const ch = pi.latest_charge as Stripe.Charge | null;
      if (ch) {
        const out = ch.outcome;
        if (out?.risk_level === "elevated") add(2, "Stripe Radar rates this payment as elevated risk");
        if (out?.risk_level === "highest") add(4, "Stripe Radar rates this payment as highest risk");
        if (out?.type === "manual_review") add(2, "Stripe Radar put this payment in manual review");
        const card = ch.payment_method_details?.card;
        if (card?.checks?.cvc_check === "fail") add(2, "Card security code (CVC) check failed");
        if (card?.checks?.address_postal_code_check === "fail") add(1, "Billing postcode doesn't match the card");
        if (card?.checks?.address_line1_check === "fail") add(1, "Billing address doesn't match the card");
        const ship = (JSON.parse(o.shippingAddress || "{}") as { country?: string }).country;
        if (card?.country && ship && card.country !== ship) add(1, `Card issued in ${card.country} but shipping to ${ship}`);
      }
    }
    const { highValueMinor } = await getSetting("checkout");
    const prior = o.customerId ? await prisma.order.count({ where: { customerId: o.customerId, paymentStatus: "paid", id: { not: o.id } } }) : 0;
    if (!prior && o.total >= highValueMinor) add(1, "First order from this customer and a high value");
    const recent = o.customerId ? await prisma.order.count({ where: { customerId: o.customerId, createdAt: { gt: new Date(Date.now() - 3600_000) } } }) : 0;
    if (recent >= 4) add(2, `${recent} orders from this customer in the last hour`);

    const level: Level = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
    await flag(orderId, level, reasons.join(". "));
  } catch (e) {
    console.error("fraud screening failed:", (e as Error).message);
  }
}

/** Raise (never lower) the risk on an order, e.g. from a Stripe dispute or early-fraud-warning event. */
export async function flag(orderId: string, level: Level, note: string) {
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  if (!o) return;
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const keep = o.riskLevel && rank[o.riskLevel as Level] > rank[level];
  const next = keep ? (o.riskLevel as Level) : level;
  const notes = [o.riskNote, note].filter(Boolean).join(" | ").slice(0, 2000);
  const tags = JSON.parse(o.tags || "[]") as string[];
  if (next !== "low" && !tags.includes("risk-" + next)) tags.push("risk-" + next);
  await prisma.order.update({ where: { id: orderId }, data: { riskLevel: next, riskNote: notes || null, tags: JSON.stringify(tags.filter((t) => !(t.startsWith("risk-") && t !== "risk-" + next))) } });
  if (next === "high" && level === "high") {
    void emitOrder("order.flagged", orderId);
    void alertOwners(o.number, note);
  }
}

async function alertOwners(number: number, note: string) {
  const owners = await prisma.adminUser.findMany({ where: { active: true, role: { name: "Owner", isSystem: true } }, select: { email: true } });
  const site = process.env.STOREFRONT_URL ?? "";
  for (const ow of owners)
    await sendMail({
      to: ow.email, kind: "fraud_alert",
      subject: `Review order #${number}: high fraud risk`,
      html: `<p>Order <b>#${number}</b> at ${esc(storeName())} was flagged as <b>high risk</b>. Hold shipping until you've checked it.</p><p>${esc(note)}</p><p><a href="${esc(site)}/admin/orders">Open orders</a></p>`,
      text: `Order #${number} was flagged high risk. Hold shipping until checked.\n${note}\n${site}/admin/orders`,
    });
}
