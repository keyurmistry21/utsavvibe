import { stripe } from "./stripe.js";
import { getSetting } from "./appSettings.js";

export type TaxAddress = { line1?: string; city?: string; region?: string; postcode?: string; country: string };
type Line = { variantId?: string | null; unitPrice: number; quantity: number; taxable: boolean };

// "Automatic tax" = Stripe Tax works out the tax from the shipping address (rates, thresholds, exemptions) instead of the
// fixed per-market percentage. Costs 0.5% per transaction in Stripe fees; you still register for tax where required and
// add those registrations in the Stripe Dashboard. If Stripe Tax can't answer, the caller falls back to the market rate.
export async function stripeTax(o: { currency: string; inclusive: boolean; lines: Line[]; shipping: number; address: TaxAddress }) {
  if (!(await getSetting("checkout")).automaticTax || !process.env.STRIPE_SECRET_KEY) return null;
  if (!o.address.country || !o.address.postcode) return null;
  const behavior = o.inclusive ? "inclusive" : "exclusive";
  try {
    const calc = await stripe().tax.calculations.create({
      currency: o.currency.toLowerCase(),
      customer_details: { address: { line1: o.address.line1 || undefined, city: o.address.city || undefined, state: o.address.region || undefined, postal_code: o.address.postcode, country: o.address.country }, address_source: "shipping" },
      line_items: o.lines.map((l, i) => ({
        amount: l.unitPrice * l.quantity,
        quantity: 1,
        reference: `${i}-${l.variantId ?? "item"}`.slice(0, 200),
        tax_behavior: behavior,
        tax_code: l.taxable ? "txcd_99999999" : "txcd_00000000", // general tangible goods / non-taxable
      })),
      ...(o.shipping > 0 ? { shipping_cost: { amount: o.shipping, tax_behavior: behavior } } : {}),
    });
    return { id: calc.id, tax: o.inclusive ? calc.tax_amount_inclusive : calc.tax_amount_exclusive };
  } catch (e) {
    console.error("Stripe Tax failed, using the market rate:", (e as Error).message);
    return null;
  }
}

/** After payment: record the sale for Stripe Tax reporting. Best effort. */
export async function recordTax(calcId: string | null, orderNumber: number) {
  if (!calcId) return;
  try {
    await stripe().tax.transactions.createFromCalculation({ calculation: calcId, reference: `order-${orderNumber}` }, { idempotencyKey: `taxtx-${calcId}` });
  } catch (e) {
    console.error("recording Stripe Tax transaction failed:", (e as Error).message);
  }
}
