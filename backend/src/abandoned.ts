import { randomBytes } from "node:crypto";
import { prisma } from "./db.js";
import { abandonedEmail, type EmailOrder } from "./emails.js";
import { sendMail } from "./mail.js";
import { sign } from "./secrets.js";
import { getSetting } from "./appSettings.js";
import { emitOrder } from "./webhooks.js";

const MAX_AGE_MS = 7 * 24 * 3600_000;

export const unsubscribeUrl = (customerId: string) => `${(process.env.STOREFRONT_URL ?? "").replace(/\/$/, "")}/api/store/unsubscribe?c=${encodeURIComponent(customerId)}&t=${sign("unsub:" + customerId)}`;
export const validUnsubscribe = (customerId: string, t: string) => t === sign("unsub:" + customerId);

// A checkout the customer started but never paid: Stripe session expired (failed) or still open (pending). Admin-cancelled
// orders and draft orders are excluded. Only customers who ticked the reminder box get an email, once per order.
const candidates = (cutoff: Date) =>
  prisma.order.findMany({
    where: {
      stripeSessionId: { not: null }, recoveryEmailAt: null, status: { not: "draft" }, createdAt: { lt: cutoff, gt: new Date(Date.now() - MAX_AGE_MS) },
      OR: [{ paymentStatus: "failed" }, { paymentStatus: "pending", status: "open" }],
      customer: { acceptsEmail: true, email: { not: null } },
    },
    include: { items: true, customer: true, market: { include: { regions: true } } },
    take: 50,
  });

export async function sendRecovery(orderId: string, opts: { force?: boolean } = {}) {
  const o = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, customer: true, market: { include: { regions: true } } } });
  if (!o?.customer?.email) return { status: "no_email" as const };
  if (o.paymentStatus === "paid") return { status: "paid" as const };
  if (!opts.force && !o.customer.acceptsEmail) return { status: "no_consent" as const };
  if (!opts.force && o.recoveryEmailAt) return { status: "already_sent" as const };
  // they came back and bought something else since: no nag
  if (await prisma.order.count({ where: { customerId: o.customerId, paymentStatus: "paid", createdAt: { gt: o.createdAt } } })) return { status: "bought_since" as const };
  const token = o.recoveryToken ?? randomBytes(32).toString("base64url");
  await prisma.order.update({ where: { id: o.id }, data: { recoveryToken: token } });
  const url = `${(process.env.STOREFRONT_URL ?? "").replace(/\/$/, "")}/${o.market.code.toLowerCase()}/cart?recover=${token}`;
  const unsub = unsubscribeUrl(o.customer.id);
  const r = await sendMail({
    to: o.customer.email, kind: "abandoned_checkout", orderId: o.id,
    headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    ...abandonedEmail(o as unknown as EmailOrder, url, unsub),
  });
  if (r.status === "sent") {
    await prisma.order.update({ where: { id: o.id }, data: { recoveryEmailAt: new Date() } });
    void emitOrder("checkout.abandoned", o.id);
  }
  return r;
}

let running = false;
export async function runAbandonedJob() {
  if (running) return;
  running = true;
  try {
    const s = await getSetting("marketing");
    if (!s.abandonedEnabled) return;
    for (const o of await candidates(new Date(Date.now() - s.delayHours * 3600_000))) await sendRecovery(o.id);
  } catch (e) {
    console.error("abandoned job failed:", (e as Error).message);
  } finally {
    running = false;
  }
}

export const startAbandonedJob = () => void setInterval(() => void runAbandonedJob(), 10 * 60_000).unref();

/** Cart contents for a recovery link, only while the order is still unpaid. */
export async function recoverCart(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const o = await prisma.order.findFirst({ where: { recoveryToken: token, paymentStatus: { not: "paid" }, createdAt: { gt: new Date(Date.now() - 14 * 24 * 3600_000) } }, include: { items: true, customer: true, market: true } });
  if (!o) return null;
  return {
    marketCode: o.market.code,
    email: o.customer?.email ?? "",
    name: o.customer?.name ?? "",
    items: o.items.filter((i) => i.variantId).map((i) => ({ variantId: i.variantId!, title: i.title, quantity: i.quantity })),
  };
}
