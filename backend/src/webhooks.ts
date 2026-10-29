import { createHmac } from "node:crypto";
import { prisma, parseJson } from "./db.js";
import { assertPublicUrl } from "./ssrf.js";

export const EVENTS = ["order.paid", "order.fulfilled", "order.cancelled", "order.refunded", "order.flagged", "checkout.abandoned"] as const;
export type WebhookEvent = (typeof EVENTS)[number];

const RETRY_MS = [0, 30_000, 5 * 60_000]; // in-process retries; a restart drops pending retries (check the delivery log)

async function deliver(endpointId: string, event: string, body: string, attempt = 0): Promise<void> {
  const ep = await prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
  if (!ep || !ep.active) return;
  let status = 0;
  let error = "";
  try {
    const u = await assertPublicUrl(ep.url);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", ep.secret).update(`${t}.${body}`).digest("hex");
    const r = await fetch(u, {
      method: "POST",
      redirect: "manual", // a redirect could point at an internal address
      signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/json", "user-agent": "UtsavVibe-Webhooks/1", "x-utsavvibe-event": event, "x-utsavvibe-signature": `t=${t},v1=${sig}` },
      body,
    });
    status = r.status;
    if (!r.ok) error = `HTTP ${r.status}`;
  } catch (e) {
    error = (e as Error).message.slice(0, 300);
  }
  await prisma.webhookDelivery.create({ data: { endpointId, event, status, error } }).catch(() => {});
  if ((status < 200 || status >= 300) && attempt + 1 < RETRY_MS.length) setTimeout(() => void deliver(endpointId, event, body, attempt + 1), RETRY_MS[attempt + 1]).unref();
}

/** Fire-and-forget: a slow or broken endpoint never slows or breaks the store. */
export function emit(event: WebhookEvent, data: unknown) {
  void (async () => {
    const eps = await prisma.webhookEndpoint.findMany({ where: { active: true } });
    const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data });
    for (const ep of eps) if (parseJson<string[]>(ep.events, []).includes(event)) void deliver(ep.id, event, body);
  })().catch((e) => console.error("webhook emit failed:", (e as Error).message));
}

export async function sendTest(endpointId: string) {
  await deliver(endpointId, "ping", JSON.stringify({ event: "ping", createdAt: new Date().toISOString(), data: {} }), RETRY_MS.length);
}

export async function emitOrder(event: WebhookEvent, orderId: string) {
  const o = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, customer: true } });
  if (!o) return;
  emit(event, {
    id: o.id, number: o.number, currency: o.currency, subtotal: o.subtotal, tax: o.tax, shipping: o.shipping, discount: o.discount, total: o.total,
    status: o.status, paymentStatus: o.paymentStatus, riskLevel: o.riskLevel, trackingNumber: o.trackingNumber, createdAt: o.createdAt,
    customer: o.customer && { email: o.customer.email, name: o.customer.name, phone: o.customer.phone },
    shippingAddress: parseJson(o.shippingAddress, {}),
    items: o.items.map((i) => ({ title: i.title, quantity: i.quantity, unitPrice: i.unitPrice, variantId: i.variantId })),
  });
}
