import { randomInt } from "node:crypto";
import { prisma } from "./db.js";
import { giftCardEmail } from "./emails.js";
import { sendMail } from "./mail.js";

// No 0/O/1/I so codes survive being read out loud. 16 chars ≈ 79 bits: not guessable.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newCode = () => Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");

/** "abcd efgh-ijkl mnop" -> "ABCD-EFGH-IJKL-MNOP". Anything that isn't 16 letters/digits is returned cleaned but ungrouped (will simply not match). */
export function normalizeCode(input: string) {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 16 ? c.match(/.{4}/g)!.join("-") : c;
}

export const MIN_CHARGE = 50; // Stripe won't charge less than about this in GBP/USD/CAD

/** A card that can be spent right now in `currency`, or a reason it can't. Same wording for unknown/disabled so codes can't be probed. */
export async function usableCard(code: string, currency: string) {
  const card = await prisma.giftCard.findUnique({ where: { code: normalizeCode(code) } });
  if (!card || !card.active || (card.expiresAt && card.expiresAt < new Date())) throw Object.assign(new Error("That gift card code isn't valid"), { status: 400 });
  if (card.currency !== currency) throw Object.assign(new Error(`This gift card is in ${card.currency} and can't be used in this market`), { status: 400 });
  if (card.balance <= 0) throw Object.assign(new Error("This gift card has no balance left"), { status: 400 });
  return card;
}

/** How much of `total` the card covers. If the rest would be too small for Stripe to charge, leave exactly MIN_CHARGE for card payment. */
export function splitPayment(balance: number, total: number, cap = total) {
  // `cap`: Stripe can only discount line items, never the shipping charge, so the card can't cover more than the items (and added tax)
  let applied = Math.min(balance, total, cap);
  const rest = total - applied;
  if (rest > 0 && rest < MIN_CHARGE) applied = Math.max(0, total - MIN_CHARGE);
  return { applied, due: total - applied };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Take `amount` off the card for this order. Atomic: two checkouts can't both spend the same balance. */
export async function reserve(tx: Tx, cardId: string, amount: number, orderId: string) {
  const r = await tx.giftCard.updateMany({ where: { id: cardId, active: true, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
  if (!r.count) throw Object.assign(new Error("The gift card balance changed. Please try again."), { status: 409 });
  await tx.giftCardTx.create({ data: { giftCardId: cardId, orderId, amount: -amount, kind: "redeem", note: "" } });
}

/** Give the reserved amount back (payment failed/expired, or the order was cancelled). Safe to call repeatedly. */
export async function releaseForOrder(orderId: string) {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.giftCardTx.findMany({ where: { orderId } });
    const byCard = new Map<string, number>();
    for (const t of rows) if (t.kind === "redeem" || t.kind === "release") byCard.set(t.giftCardId, (byCard.get(t.giftCardId) ?? 0) + t.amount);
    for (const [cardId, net] of byCard) {
      if (net >= 0) continue; // already released
      await tx.giftCard.update({ where: { id: cardId }, data: { balance: { increment: -net } } });
      await tx.giftCardTx.create({ data: { giftCardId: cardId, orderId, amount: -net, kind: "release", note: "Order not completed" } });
    }
  });
}

export async function issueCard(o: { amount: number; currency: string; recipientEmail?: string | null; note?: string; expiresAt?: Date | null; orderId?: string; orderItemId?: string }) {
  for (let i = 0; i < 5; i++) {
    try {
      return await prisma.giftCard.create({
        data: {
          code: newCode(), currency: o.currency, initialAmount: o.amount, balance: o.amount, recipientEmail: o.recipientEmail || null, note: o.note ?? "", expiresAt: o.expiresAt ?? null,
          orderId: o.orderId ?? null, orderItemId: o.orderItemId ?? null, txs: { create: { amount: o.amount, kind: "issue", orderId: o.orderId ?? null, note: o.orderId ? "Sold online" : "Issued by staff" } },
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e; // random code collided: try another
    }
  }
  throw new Error("could not generate a unique gift card code");
}

export async function emailCard(card: { code: string; balance: number; currency: string; expiresAt: Date | null }, to: string, orderId?: string) {
  return sendMail({ to, kind: "gift_card", orderId, ...giftCardEmail({ code: card.code, amount: card.balance, currency: card.currency, expiresAt: card.expiresAt }) });
}

/** Called when an order becomes paid. Issues one card per gift card unit bought and emails the buyer. Idempotent per order line. */
export async function issueForPaidOrder(orderId: string) {
  try {
    const o = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, customer: true } });
    if (!o || o.paymentStatus !== "paid") return;
    for (const item of o.items.filter((i) => i.giftCard)) {
      const have = await prisma.giftCard.count({ where: { orderItemId: item.id } });
      for (let n = have; n < item.quantity; n++) {
        const card = await issueCard({ amount: item.unitPrice, currency: o.currency, recipientEmail: o.customer?.email, orderId, orderItemId: item.id });
        if (o.customer?.email) await emailCard(card, o.customer.email, orderId);
      }
    }
  } catch (e) {
    console.error("gift card issue failed:", (e as Error).message);
  }
}
