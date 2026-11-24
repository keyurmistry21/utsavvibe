import { prisma } from "./db.js";

const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 });
export const normalizeCode = (c: string) => c.trim().toUpperCase().replace(/\s+/g, "");

/** What a code does to a cart. Throws a customer-friendly message when it can't be used. */
export type CartUnit = { productId: string; unitPrice: number; quantity: number };

export async function discountFor(rawCode: string | undefined, cart: { currency: string; subtotal: number; units?: CartUnit[] }) {
  if (!rawCode?.trim()) return null;
  const code = normalizeCode(rawCode);
  const d = await prisma.discountCode.findUnique({ where: { code } });
  const now = new Date();
  if (!d || !d.active) throw bad("That discount code isn't valid");
  if (d.startsAt && d.startsAt > now) throw bad("That discount code isn't active yet");
  if (d.endsAt && d.endsAt < now) throw bad("That discount code has expired");
  if (d.usageLimit != null && d.usedCount >= d.usageLimit) throw bad("That discount code has been fully used");
  if (d.kind === "fixed" && d.currency && d.currency !== cart.currency) throw bad(`That code only works for orders in ${d.currency}`);
  if (cart.subtotal < d.minSubtotal) throw bad(`Spend ${(d.minSubtotal / 100).toFixed(2)} ${cart.currency} or more to use that code`);
  if (d.kind === "buy_x_get_y") {
    // every (buy + get) units earns `get` units at `getPercent` off, taken from the cheapest eligible units
    const prices = (cart.units ?? []).filter((u) => !d.productId || u.productId === d.productId).flatMap((u) => Array(u.quantity).fill(u.unitPrice) as number[]).sort((a, b) => a - b);
    const group = d.buyQty + d.getQty;
    const free = group > 0 ? Math.floor(prices.length / group) * d.getQty : 0;
    if (!free) throw bad(`Add ${d.buyQty} item${d.buyQty === 1 ? "" : "s"} and ${d.getQty} more to use that code`);
    const amount = Math.round(prices.slice(0, free).reduce((a, p) => a + p, 0) * (Math.min(d.getPercent, 100) / 100));
    return { record: d, code: d.code, amount, freeShipping: false, label: `Buy ${d.buyQty}, get ${d.getQty}${d.getPercent >= 100 ? " free" : ` at ${d.getPercent}% off`}` };
  }
  const amount = d.kind === "percent" ? Math.round((cart.subtotal * Math.min(d.value, 100)) / 100) : d.kind === "fixed" ? Math.min(d.value, cart.subtotal) : 0;
  return { record: d, code: d.code, amount, freeShipping: d.kind === "free_shipping", label: d.kind === "percent" ? `${d.value}% off` : d.kind === "fixed" ? "Discount" : "Free shipping" };
}

/** Use a code once, atomically: the update only matches while there are uses left, so two buyers can't both take the last one. */
export async function takeUse(tx: Pick<typeof prisma, "discountCode">, id: string) {
  const r = await tx.discountCode.updateMany({ where: { id, active: true, OR: [{ usageLimit: null }, { usedCount: { lt: prisma.discountCode.fields.usageLimit } }] }, data: { usedCount: { increment: 1 } } });
  if (!r.count) throw bad("That discount code has just been fully used");
}

/** Give a use back when the order never got paid (Stripe failed or the checkout expired). Idempotent per order. */
export async function releaseDiscount(orderId: string) {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { discountCode: true, discountReleased: true } });
  if (!o?.discountCode || o.discountReleased) return;
  const flip = await prisma.order.updateMany({ where: { id: orderId, discountReleased: false }, data: { discountReleased: true } });
  if (flip.count) await prisma.discountCode.updateMany({ where: { code: o.discountCode, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
}
