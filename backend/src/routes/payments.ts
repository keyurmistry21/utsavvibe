import { Router } from "express";
import { stripe } from "../stripe.js";

// Read-only view of the connected Stripe account: status, payout bank (last 4 only), balance, recent payouts.
// Card and bank details are never collected or stored here: customers pay on Stripe's hosted page, and the payout
// bank account is added in the Stripe Dashboard, where Stripe verifies it.
export const paymentsRouter = Router();

const mode = (key: string) => (key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "test");

paymentsRouter.get("/", async (_req, res) => {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const base = {
    configured: !!key,
    mode: key ? mode(key) : null,
    webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
    webhookPath: "/api/webhooks/stripe",
    account: null as null | Record<string, unknown>,
    banks: [] as { bank: string; last4: string; currency: string; country: string; status: string | null }[],
    balance: [] as { currency: string; available: number; pending: number }[],
    payouts: [] as { id: string; amount: number; currency: string; status: string; arrival: string }[],
    error: "",
  };
  if (!key) return void res.json(base);
  try {
    const s = stripe();
    const acct = await s.accounts.retrieveCurrent();
    base.account = {
      id: acct.id,
      name: acct.settings?.dashboard?.display_name || acct.business_profile?.name || acct.email || acct.id,
      country: acct.country,
      currency: acct.default_currency,
      chargesEnabled: acct.charges_enabled,
      payoutsEnabled: acct.payouts_enabled,
      detailsSubmitted: acct.details_submitted,
      due: acct.requirements?.currently_due ?? [],
    };
    const [ext, bal, pay] = await Promise.allSettled([
      s.accounts.listExternalAccounts(acct.id, { object: "bank_account", limit: 5 }),
      s.balance.retrieve(),
      s.payouts.list({ limit: 5 }),
    ]);
    if (ext.status === "fulfilled") {
      base.banks = ext.value.data.map((b) => {
        const x = b as { bank_name?: string | null; last4: string; currency: string; country: string; status?: string };
        return { bank: x.bank_name ?? "Bank account", last4: x.last4, currency: x.currency, country: x.country, status: x.status ?? null };
      });
    }
    if (bal.status === "fulfilled") {
      const m = new Map<string, { currency: string; available: number; pending: number }>();
      for (const a of bal.value.available) m.set(a.currency, { currency: a.currency, available: a.amount, pending: 0 });
      for (const p of bal.value.pending) m.set(p.currency, { currency: p.currency, available: m.get(p.currency)?.available ?? 0, pending: p.amount });
      base.balance = [...m.values()];
    }
    if (pay.status === "fulfilled") {
      base.payouts = pay.value.data.map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, status: p.status, arrival: new Date(p.arrival_date * 1000).toISOString() }));
    }
  } catch (e) {
    base.error = (e as Error).message;
  }
  res.json(base);
});
