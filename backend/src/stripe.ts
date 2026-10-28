import Stripe from "stripe";

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw Object.assign(new Error("STRIPE_SECRET_KEY not set"), { status: 500 });
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY));
}
