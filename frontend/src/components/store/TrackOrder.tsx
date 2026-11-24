"use client";

import { useState } from "react";
import { money } from "@/lib/api";

type Result = { number: number; placedAt: string; currency: string; total: number; refunded: number; status: string; paymentStatus: string; inStore: boolean; items: { title: string; quantity: number }[]; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null };

const STEPS = ["Placed", "Paid", "Shipped"] as const;
function stage(r: Result) {
  if (r.status === "cancelled") return { label: "Cancelled", step: -1 };
  if (r.paymentStatus === "refunded") return { label: "Refunded", step: -1 };
  if (r.paymentStatus !== "paid") return { label: "Waiting for payment", step: 0 };
  if (r.status === "fulfilled") return { label: r.inStore ? "Collected in store" : r.trackingNumber ? "On its way" : "Shipped", step: 2 };
  return { label: "Paid, being prepared", step: 1 };
}

export function TrackOrder() {
  const [number, setNumber] = useState("");
  const [email, setEmail] = useState("");
  const [r, setR] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setR(null); setBusy(true);
    try {
      const res = await fetch("/api/store/order-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: number.replace(/\D/g, ""), email }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error === "validation" ? "Enter your order number and the email you used." : data.error ?? "Something went wrong");
      setR(data);
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const st = r && stage(r);

  return (
    <>
      <form onSubmit={find} className="trackform">
        <div className="field"><label htmlFor="to-num">Order number</label><input id="to-num" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 1042" required /></div>
        <div className="field"><label htmlFor="to-email">Email used at checkout</label><input id="to-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></div>
        <button className="primary" disabled={busy}>{busy ? "Looking…" : "Track order"}</button>
      </form>
      {err && <div className="error" role="alert">{err}</div>}
      {r && st && (
        <div className="card trackcard">
          <h2>Order #{r.number}</h2>
          <p className="muted">Placed {new Date(r.placedAt).toLocaleDateString()} · {money(r.total, r.currency)}</p>
          <p className="trackstatus">{st.label}</p>
          {st.step >= 0 && (
            <ol className="tracksteps" aria-label="Progress">
              {STEPS.map((s, i) => <li key={s} className={i <= st.step ? "on" : ""}>{s}</li>)}
            </ol>
          )}
          {r.refunded > 0 && <p>Refunded {money(r.refunded, r.currency)}.</p>}
          {r.trackingNumber && (
            <p>{r.carrier ? `${r.carrier.toUpperCase()} · ` : ""}Tracking number {r.trackingUrl ? <a href={r.trackingUrl} target="_blank" rel="noreferrer noopener">{r.trackingNumber}</a> : <b>{r.trackingNumber}</b>}</p>
          )}
          <ul className="trackitems">{r.items.map((i, k) => <li key={k}>{i.quantity} × {i.title}</li>)}</ul>
        </div>
      )}
    </>
  );
}
