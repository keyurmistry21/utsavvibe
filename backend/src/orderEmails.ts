import { prisma } from "./db.js";
import { orderConfirmationEmail, paymentLinkEmail, type EmailOrder } from "./emails.js";
import { sendMail, type SendResult } from "./mail.js";

const include = { items: true, customer: true, market: { include: { regions: true } } } as const;

const load = (orderId: string) => prisma.order.findUnique({ where: { id: orderId }, include });

// Sent once per order unless `force` (staff pressing "Resend"). Safe to call from webhooks: never throws.
export async function sendOrderConfirmation(orderId: string, opts: { force?: boolean } = {}): Promise<SendResult | { status: "already_sent" | "no_email" }> {
  try {
    const o = await load(orderId);
    if (!o?.customer?.email) return { status: "no_email" };
    if (!opts.force && (await prisma.emailLog.count({ where: { orderId, kind: "order_confirmation", status: "sent" } }))) return { status: "already_sent" };
    const m = orderConfirmationEmail(o as unknown as EmailOrder);
    return await sendMail({ to: o.customer.email, kind: "order_confirmation", orderId, ...m });
  } catch (e) {
    console.error("order confirmation failed:", (e as Error).message);
    return { status: "failed", error: (e as Error).message };
  }
}

export async function sendPaymentLinkEmail(orderId: string): Promise<SendResult | { status: "no_email" | "no_link" }> {
  const o = await load(orderId);
  if (!o?.customer?.email) return { status: "no_email" };
  if (!o.paymentLinkUrl) return { status: "no_link" };
  const m = paymentLinkEmail(o as unknown as EmailOrder, o.paymentLinkUrl);
  return sendMail({ to: o.customer.email, kind: "payment_link", orderId, ...m });
}

export async function previewEmail(orderId: string, kind: "order_confirmation" | "payment_link") {
  const o = await load(orderId);
  if (!o) return null;
  return kind === "order_confirmation" ? orderConfirmationEmail(o as unknown as EmailOrder) : paymentLinkEmail(o as unknown as EmailOrder, o.paymentLinkUrl ?? "https://checkout.stripe.com/c/pay/example");
}
