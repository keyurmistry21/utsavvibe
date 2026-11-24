import type Stripe from "stripe";
import { stripe } from "./stripe.js";

type Line = { title: string; quantity: number; unitPrice: number; imageUrl?: string }; // imageUrl: absolute https URL (Stripe fetches it)

// Shared by storefront checkout and admin draft payment links.
export async function createCheckoutSession(o: {
  orderId: string;
  orderNumber: number;
  marketCode: string;
  currency: string; // GBP, USD, CAD
  taxInclusive: boolean;
  taxRateBps: number;
  lines: Line[];
  tax: number;
  discount: number;
  discountNote?: string | null;
  shipping: number;
  shippingName: string;
  email: string;
  expiresInHours?: number;
}) {
  const currency = o.currency.toLowerCase();
  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = o.lines.map((l) => ({
    quantity: l.quantity,
    price_data: { currency, unit_amount: l.unitPrice, product_data: { name: l.title, ...(l.imageUrl ? { images: [l.imageUrl] } : {}) } },
  }));
  if (!o.taxInclusive && o.tax > 0)
    line_items.push({ quantity: 1, price_data: { currency, unit_amount: o.tax, product_data: { name: `Tax (${o.taxRateBps / 100}%)` } } });

  // Stripe can't take negative line items, so discounts go through a one-off coupon.
  const discounts: Stripe.Checkout.SessionCreateParams.Discount[] = [];
  if (o.discount > 0) {
    const coupon = await stripe().coupons.create({ amount_off: o.discount, currency, duration: "once", name: o.discountNote || "Discount" });
    discounts.push({ coupon: coupon.id });
  }

  const base = process.env.STOREFRONT_URL;
  const m = o.marketCode.toLowerCase();
  return stripe().checkout.sessions.create({
    mode: "payment",
    customer_email: o.email,
    line_items,
    ...(discounts.length ? { discounts } : {}),
    shipping_options: [{ shipping_rate_data: { type: "fixed_amount", display_name: o.shippingName || "Shipping", fixed_amount: { amount: o.shipping, currency } } }],
    metadata: { orderId: o.orderId },
    payment_intent_data: { metadata: { orderId: o.orderId } },
    ...(o.expiresInHours ? { expires_at: Math.floor(Date.now() / 1000) + o.expiresInHours * 3600 } : {}),
    success_url: `${base}/${m}/order/${o.orderNumber}`,
    cancel_url: `${base}/${m}/cart`,
  });
}
