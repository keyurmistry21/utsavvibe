"use client";

import { money } from "@/lib/api";
import { External } from "../Icons";
import { useApi } from "./hooks";

type Info = {
  configured: boolean; mode: "live" | "test" | null; webhookConfigured: boolean; webhookPath: string; error: string;
  account: { id: string; name: string; country: string; currency: string; chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean; due: string[] } | null;
  banks: { bank: string; last4: string; currency: string; country: string; status: string | null }[];
  balance: { currency: string; available: number; pending: number }[];
  payouts: { id: string; amount: number; currency: string; status: string; arrival: string }[];
};

const Step = ({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) => (
  <div className="paystep">
    <span className={`paydot ${done ? "ok" : ""}`} aria-hidden="true">{done ? "✓" : ""}</span>
    <div><b>{title}</b>{children && <div className="muted">{children}</div>}</div>
  </div>
);

export function Payments() {
  const { data: p, error, reload } = useApi<Info>("/payments");
  const dash = (path: string) => `https://dashboard.stripe.com/${p?.mode === "test" ? "test/" : ""}${path}`;
  const hasBank = !!p?.banks.length;
  return (
    <>
      <div className="pagehead">
        <div><h2>Payments</h2><div className="muted">Customers pay by card on Stripe's secure page, and Stripe pays the money out to your bank.</div></div>
        <div className="headtools"><button onClick={reload}>Refresh</button></div>
      </div>
      {(error || p?.error) && <div className="error">{error || p?.error}</div>}
      {p && (
        <>
          <div className="card" style={{ maxWidth: 760 }}>
            <div className="cardhead"><h3>Setup</h3>{p.mode && <span className={`badge ${p.mode === "live" ? "ok" : ""}`}>{p.mode === "live" ? "Live payments" : "Test mode (no real money)"}</span>}</div>
            <Step done={p.configured} title="Connect Stripe">
              {p.configured ? "Your Stripe secret key is set." : <>Create a Stripe account, then copy your secret key into <code>backend/.env</code> as <code>STRIPE_SECRET_KEY</code> and restart the API. <a className="lnk" href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">Get API keys<External /></a></>}
            </Step>
            <Step done={p.webhookConfigured} title="Add the payment webhook">
              {p.webhookConfigured ? "Webhook secret is set, so paid orders update automatically." : <>In Stripe → Developers → Webhooks add the endpoint <code>https://YOUR-DOMAIN{p.webhookPath}</code> with the events <code>checkout.session.completed</code>, <code>checkout.session.expired</code> and <code>charge.refunded</code>, then put its signing secret in <code>STRIPE_WEBHOOK_SECRET</code>. Locally run <code>stripe listen --forward-to localhost:4000{p.webhookPath}</code>.</>}
            </Step>
            <Step done={hasBank} title="Add your bank account for payouts">
              {hasBank ? "Stripe will pay out to the account below." : p.configured ? "No payout bank account found yet. Add it in your Stripe Dashboard (Stripe verifies it for you)." : "Available after Stripe is connected."}
            </Step>
            <p style={{ marginBottom: 0 }}>
              <a className="btn-link" href={dash("settings/payouts")} target="_blank" rel="noreferrer">{hasBank ? "Change bank account in Stripe" : "Add bank account in Stripe"}<External /></a>
            </p>
          </div>

          {p.account && (
            <div className="card" style={{ maxWidth: 760 }}>
              <h3>Stripe account</h3>
              <div className="kv"><span>Name</span><b>{p.account.name}</b></div>
              <div className="kv"><span>Country · currency</span><b>{p.account.country} · {p.account.currency?.toUpperCase()}</b></div>
              <div className="kv"><span>Accepting card payments</span><span className={`badge ${p.account.chargesEnabled ? "ok" : ""}`}>{p.account.chargesEnabled ? "Yes" : "Not yet"}</span></div>
              <div className="kv"><span>Payouts to your bank</span><span className={`badge ${p.account.payoutsEnabled ? "ok" : ""}`}>{p.account.payoutsEnabled ? "Enabled" : "Not yet"}</span></div>
              {(!p.account.detailsSubmitted || p.account.due.length > 0) && (
                <div className="error" style={{ marginTop: 10 }}>Stripe still needs some business details before it can pay you out. <a className="lnk" href={dash("settings/account")} target="_blank" rel="noreferrer">Finish in Stripe<External /></a></div>
              )}
            </div>
          )}

          {hasBank && (
            <div className="card" style={{ maxWidth: 760 }}>
              <h3>Payout bank account</h3>
              {p.banks.map((b) => (
                <div key={b.last4 + b.bank} className="kv"><span>{b.bank}</span><b>•••• {b.last4} · {b.country} · {b.currency.toUpperCase()}</b></div>
              ))}
              <p className="muted" style={{ marginBottom: 0 }}>Only the last 4 digits are shown. Full account and card numbers are never stored in this app.</p>
            </div>
          )}

          {(p.balance.length > 0 || p.payouts.length > 0) && (
            <div className="card" style={{ maxWidth: 760 }}>
              <h3>Balance and payouts</h3>
              {p.balance.map((b) => (
                <div key={b.currency} className="kv"><span>{b.currency.toUpperCase()} balance</span><b>{money(b.available, b.currency.toUpperCase())} available · {money(b.pending, b.currency.toUpperCase())} pending</b></div>
              ))}
              {p.payouts.length > 0 && (
                <table style={{ marginTop: 10 }}>
                  <thead><tr><th>Arrives</th><th>Status</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                  <tbody>{p.payouts.map((x) => <tr key={x.id}><td>{new Date(x.arrival).toLocaleDateString()}</td><td><span className={`badge ${x.status === "paid" ? "ok" : ""}`}>{x.status}</span></td><td style={{ textAlign: "right" }}>{money(x.amount, x.currency.toUpperCase())}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          )}

          <div className="card" style={{ maxWidth: 760 }}>
            <h3>Why there's no card form here</h3>
            <p className="muted" style={{ margin: 0 }}>Typing card or bank numbers into your own site would make you responsible for storing them (PCI rules) and still wouldn't connect to your bank. Stripe's hosted checkout takes the card, and your payout bank account is added and verified inside Stripe. This page only shows the status.</p>
          </div>
        </>
      )}
    </>
  );
}
