import { createHash } from "node:crypto";
import { prisma } from "./db.js";

// Meta Conversions API: tells Meta about a purchase from our server, so ad measurement survives blocked browser pixels.
// Needs META_PIXEL_ID (same id as NEXT_PUBLIC_META_PIXEL_ID) and META_CAPI_TOKEN (from Events Manager). Optional META_TEST_EVENT_CODE.
// Only sent when the shopper accepted marketing cookies at checkout (Order.metaConsent). Not tested against the live API from this repo.
export const capiConfigured = () => !!(process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN);
const sha = (v: string) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

export async function sendMetaPurchase(orderId: string) {
  if (!capiConfigured()) return;
  try {
    const o = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: { select: { email: true, phone: true } }, items: true, market: { select: { code: true } } } });
    if (!o || !o.metaConsent || o.paymentStatus !== "paid") return;
    const user: Record<string, string[]> = {};
    if (o.customer?.email) user.em = [sha(o.customer.email)];
    const phone = o.customer?.phone?.replace(/\D/g, "");
    if (phone) user.ph = [sha(phone)];
    const body = {
      data: [{
        event_name: "Purchase",
        event_time: Math.floor(o.createdAt.getTime() / 1000),
        event_id: `order-${o.number}`, // the browser Pixel uses the same id, so Meta counts the sale once
        action_source: "website",
        event_source_url: `${(process.env.STOREFRONT_URL ?? "").replace(/\/$/, "")}/${o.market.code.toLowerCase()}/order/${o.number}`,
        user_data: user,
        custom_data: { currency: o.currency, value: (o.total - o.tax) / 100, content_type: "product", num_items: o.items.reduce((a, i) => a + i.quantity, 0) },
      }],
      ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
    };
    const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(process.env.META_PIXEL_ID!)}/events?access_token=${encodeURIComponent(process.env.META_CAPI_TOKEN!)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!res.ok) console.error("meta capi failed", res.status, (await res.text()).slice(0, 200));
  } catch (e) { console.error("meta capi error:", (e as Error).message); }
}
