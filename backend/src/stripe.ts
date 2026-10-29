import Stripe from "stripe";

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw Object.assign(new Error("STRIPE_SECRET_KEY not set"), { status: 500 });
  // STRIPE_API_BASE only exists so tests can point at a local fake; never set it in production.
  const base = process.env.STRIPE_API_BASE && process.env.NODE_ENV !== "production" ? new URL(process.env.STRIPE_API_BASE) : null;
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY, base ? { host: base.hostname, port: base.port, protocol: base.protocol.replace(":", "") as "http" | "https" } : undefined));
}
