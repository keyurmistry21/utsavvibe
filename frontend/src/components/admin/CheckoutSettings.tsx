"use client";

import { useEffect, useState } from "react";
import { api, toMajor, toMinor } from "@/lib/api";
import { Switch } from "./Switch";
import { useApi } from "./hooks";
import { useDirty, useUnsavedGuard } from "./unsaved";

type S = { automaticTax: boolean; highValueMinor: number; stripeConfigured: boolean };

export function CheckoutSettings() {
  const { data, error, reload } = useApi<S>("/settings/checkout");
  const [tax, setTax] = useState(false);
  const [high, setHigh] = useState("300.00");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setTax(data.automaticTax); setHigh(toMajor(data.highValueMinor)); } }, [data]);
  const { dirty, markSaved } = useDirty({ tax, high }, !!data);
  const save = async (): Promise<boolean> => {
    const n = Number(high);
    if (!high.trim() || !Number.isFinite(n) || n < 0) { setErr("Enter an amount of 0 or more"); return false; }
    setBusy(true); setErr(""); setMsg("");
    try { await api("/settings/checkout", { method: "PUT", json: { automaticTax: tax, highValueMinor: toMinor(high) } }); setMsg("Saved"); reload(); markSaved(); setBusy(false); return true; } catch (e) { setErr((e as Error).message); }
    setBusy(false);
    return false;
  };
  const { guard } = useUnsavedGuard(dirty, save);
  return (
    <>
      {guard}
      <div className="pagehead"><div><h2>Checkout and tax</h2><div className="muted">How tax is worked out, and how risky orders are flagged.</div></div></div>
      {(error || err) && <div className="error">{error || err}</div>}
      {msg && <div className="okmsg">{msg}</div>}
      <div className="card" style={{ maxWidth: 760 }}>
        <div className="cardhead">
          <span><h3 style={{ margin: 0 }}>Automatic tax</h3><div className="muted">Stripe Tax works out the tax from the shipping address.</div></span>
          <Switch checked={tax} onChange={setTax} label="Automatic tax" />
        </div>
        {data && !data.stripeConfigured && <div className="error">Stripe isn't connected yet (no <code>STRIPE_SECRET_KEY</code>), so automatic tax can't run. Orders use your market tax rates until it is.</div>}
        <ul className="muted" style={{ paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Stripe charges 0.5% of each transaction when you use it.</li>
          <li>You still need to register for tax where required, and add each registration in the Stripe Dashboard (Tax → Registrations). Without a registration, Stripe returns no tax for that place.</li>
          <li>If Stripe can't answer, the checkout falls back to the tax rate set on the market, so customers can always pay.</li>
          <li>Off: every order uses the fixed rates under Markets.</li>
        </ul>
      </div>
      <div className="card" style={{ maxWidth: 760 }}>
        <h3>Fraud screening</h3>
        <div className="field" style={{ maxWidth: 280 }}>
          <label htmlFor="cs-high">High value order (first purchase)</label>
          <input id="cs-high" inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
          <div className="muted">A customer's first order at or above this amount (in the order's own currency) adds to its risk score.</div>
        </div>
        <button className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
      <div className="card" style={{ maxWidth: 760 }}>
        <h3>How fraud screening works</h3>
        <p className="muted" style={{ marginTop: 0 }}>Every paid order is checked automatically. It only flags: you decide what to do.</p>
        <ul className="muted" style={{ paddingLeft: 20, lineHeight: 1.6 }}>
          <li><b>Stripe Radar</b> is included with Stripe and screens each card payment, blocking the worst.</li>
          <li>Card security code (CVC), billing postcode and address checks that fail.</li>
          <li>Card issued in one country but shipping to another.</li>
          <li>A big first order, or many orders from one customer within an hour.</li>
          <li>Payment disputes (chargebacks), early fraud warnings and Radar reviews raise an order to high risk.</li>
        </ul>
        <p className="muted" style={{ marginBottom: 0 }}>Risky orders get a "Review" or "High risk" badge in Orders, a banner on the order, and a tag. High risk also emails the owners. Hold shipping until you've checked it.</p>
      </div>
    </>
  );
}
