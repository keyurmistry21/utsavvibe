"use client";

import { useState } from "react";
import { api, money, toMajor, toMinor, type Order } from "@/lib/api";

type Refund = { id: string; amount: number; method: string; reason: string; restocked: string; createdAt: string; createdByEmail: string };

/** Refund all or part of a paid order, and optionally put returned items back in stock. Stripe orders refund to the card. */
export function RefundCard({ order, onDone }: { order: Order & { refunds?: Refund[] }; onDone: () => void }) {
  const left = order.total - (order.refundedAmount ?? 0);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(toMajor(left));
  const [reason, setReason] = useState("");
  const [back, setBack] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const refunds = order.refunds ?? [];
  const canRefund = order.paymentStatus === "paid" && left > 0;
  const viaStripe = order.paymentMethod === "stripe";

  const submit = async () => {
    const minor = toMinor(amount);
    if (!(minor > 0)) return setErr("Enter an amount to refund");
    if (minor > left) return setErr(`You can refund at most ${money(left, order.currency)}`);
    if (!confirm(`Refund ${money(minor, order.currency)}${viaStripe ? " to the customer's card" : " (you hand the money back yourself)"}? This can't be undone.`)) return;
    setBusy(true); setErr("");
    try {
      await api(`/orders/${order.id}/refund`, { method: "POST", json: { amount: minor, reason, restock: Object.entries(back).filter(([, q]) => q > 0).map(([itemId, quantity]) => ({ itemId, quantity })) } });
      setOpen(false); setBack({}); setReason(""); onDone();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  if (!canRefund && !refunds.length) return null;
  return (
    <div className="card">
      <div className="cardhead">
        <h3>Refunds</h3>
        {canRefund && !open && <button onClick={() => setOpen(true)}>Refund…</button>}
      </div>
      {(order.refundedAmount ?? 0) > 0 && <p className="muted">Refunded {money(order.refundedAmount ?? 0, order.currency)} of {money(order.total, order.currency)}.</p>}
      {refunds.length > 0 && (
        <ul className="refundlist">
          {refunds.map((r) => {
            let items: { title: string; quantity: number }[] = [];
            try { items = JSON.parse(r.restocked); } catch { /* none */ }
            return <li key={r.id}><b>{money(r.amount, order.currency)}</b> <span className="muted">{r.method === "stripe" ? "to card" : "manual"} · {new Date(r.createdAt).toLocaleString()}{r.createdByEmail ? ` · ${r.createdByEmail}` : ""}</span>{r.reason && <div>{r.reason}</div>}{items.length > 0 && <div className="muted">Back in stock: {items.map((i) => `${i.quantity} × ${i.title}`).join(", ")}</div>}</li>;
          })}
        </ul>
      )}
      {open && (
        <div className="refundform">
          <div className="field"><label htmlFor="rf-amt">Amount ({order.currency})</label><input id="rf-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="field"><label htmlFor="rf-why">Reason (optional)</label><input id="rf-why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. returned, damaged in transit" /></div>
          {order.items.some((i) => i.variantId) && (
            <div className="field"><label>Items coming back into stock</label>
              {order.items.filter((i) => i.variantId).map((i) => (
                <div key={i.id} className="row" style={{ alignItems: "center", marginBottom: 6 }}>
                  <span style={{ flex: 3 }}>{i.title} <span className="muted">(bought {i.quantity})</span></span>
                  <input style={{ flex: 1, minWidth: 70 }} type="number" min={0} max={i.quantity} value={back[i.id] ?? 0} onChange={(e) => setBack({ ...back, [i.id]: Math.max(0, Math.min(i.quantity, +e.target.value || 0)) })} aria-label={`Quantity of ${i.title} to restock`} />
                </div>
              ))}
            </div>
          )}
          <p className="muted">{viaStripe ? "The money goes back to the customer's card through Stripe (usually 5 to 10 days to appear)." : "This was not paid through Stripe. Hand the money back yourself; this records it."}</p>
          {err && <div className="error">{err}</div>}
          <div className="row"><button className="primary" disabled={busy} onClick={submit}>{busy ? "Refunding…" : "Refund"}</button><button onClick={() => { setOpen(false); setErr(""); }}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}
