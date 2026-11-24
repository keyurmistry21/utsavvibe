"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, money, type Order } from "@/lib/api";
import { carriers, trackingUrl } from "@/lib/carriers";
import { Badge } from "./hooks";
import { OrderEmails } from "./OrderEmails";
import { ShippingLabel } from "./ShippingLabel";
import { RefundCard } from "./RefundCard";
import { External } from "../Icons";
import { Select } from "../Select";

export function OrderDetail({ id }: { id: string }) {
  const router = useRouter();
  const [o, setO] = useState<Order | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [ship, setShip] = useState({ carrier: "", trackingNumber: "", weight: "" });
  const [payMethod, setPayMethod] = useState("bank_transfer");
  const [notify, setNotify] = useState(true);
  const [emailTick, setEmailTick] = useState(0);

  const load = () =>
    api<Order>(`/orders/${id}`).then((x) => {
      setO(x);
      setShip({ carrier: x.carrier ?? "", trackingNumber: x.trackingNumber ?? "", weight: (() => { const w = x.packageWeightG ?? x.items.reduce((t, i) => t + i.weightG * i.quantity, 0); return w ? String(w) : ""; })() });
    }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);

  const run = async (fn: () => Promise<unknown>, ok = "") => {
    setErr(""); setMsg("");
    try { await fn(); if (ok) setMsg(ok); await load(); setEmailTick((t) => t + 1); } catch (e) { setErr((e as Error).message); }
  };
  const patch = (body: object, ok?: string) => run(() => api(`/orders/${id}`, { method: "PATCH", json: body }), ok);

  if (!o) return err ? <div className="error">{err}</div> : <p>Loading…</p>;
  const addr = o.shippingAddress as Record<string, string>;
  const region = o.market.regions?.find((r) => r.code === addr.region)?.name ?? addr.region;
  const isDraft = o.status === "draft";
  const paid = o.paymentStatus === "paid";
  const shipBody = () => ({
    carrier: ship.carrier || null,
    trackingNumber: ship.trackingNumber || null,
    trackingUrl: trackingUrl(ship.carrier, ship.trackingNumber),
    packageWeightG: ship.weight ? parseInt(ship.weight) : null,
  });

  return (
    <>
      <div className="pagehead">
        <div>
          <h2 style={{ display: "inline", marginRight: 12 }}>#{o.number}</h2>
          <Badge value={o.status} /> <Badge value={o.paymentStatus} />
          <div className="muted">{new Date(o.createdAt).toLocaleString()} · {o.market.name}{o.paymentMethod ? ` · paid by ${o.paymentMethod.replace("_", " ")}` : ""}</div>
        </div>
        <Link href="/admin/orders" className="btn-link">Back to orders</Link>
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="okmsg">{msg}</div>}
      {!isDraft && (o.riskLevel === "high" || o.riskLevel === "medium") && (
        <div className={o.riskLevel === "high" ? "error" : "warnmsg"} role="alert" style={o.riskLevel === "medium" ? { background: "#fff8e6", border: "1px solid #f3d99a", color: "#6b4a00", borderRadius: 8, padding: "8px 12px", margin: "8px 0" } : undefined}>
          <b>{o.riskLevel === "high" ? "High fraud risk" : "Possible fraud risk"}.</b> Hold shipping until you've checked this order.
          {o.riskNote && <div style={{ marginTop: 4 }}>{o.riskNote}</div>}
        </div>
      )}

      <div className="cols">
        <div>
          <div className="card">
            <h3>Items</h3>
            <table>
              <tbody>
                {o.items.map((i) => <tr key={i.id}><td>{i.title}</td><td>{money(i.unitPrice, o.currency)} × {i.quantity}</td><td style={{ textAlign: "right" }}>{money(i.unitPrice * i.quantity, o.currency)}</td></tr>)}
              </tbody>
            </table>
            <div className="totals">
              <div><span>Subtotal</span><span>{money(o.subtotal, o.currency)}</span></div>
              {o.discount > 0 && <div><span>Discount{o.discountNote ? ` (${o.discountNote})` : ""}</span><span>−{money(o.discount, o.currency)}</span></div>}
              <div><span>Shipping</span><span>{o.shipping ? money(o.shipping, o.currency) : "Free"}</span></div>
              {o.taxBreakdown?.length ? o.taxBreakdown.map((t) => <div key={t.name}><span>{t.name}{o.market.taxInclusive ? " (included)" : ""}{region ? ` · ${region}` : ""}</span><span>{money(t.amount, o.currency)}</span></div>) : <div><span>{o.market.taxInclusive ? "Tax (included)" : "Tax"}{region ? ` · ${region}` : ""}</span><span>{money(o.tax, o.currency)}</span></div>}
              <div className="grand"><span>Total</span><span>{money(o.total, o.currency)}</span></div>
              {!!o.giftCardAmount && <div><span>Paid by gift card</span><span>{money(o.giftCardAmount, o.currency)}</span></div>}
            </div>
          </div>

          {isDraft ? (
            <div className="card">
              <h3>Collect payment</h3>
              <p className="muted">Send the customer a Stripe payment link, or record a payment you took yourself. The draft becomes a real order once paid.</p>
              <div className="row">
                <div>
                  <button className="primary" onClick={() => run(() => api(`/drafts/${id}/payment-link`, { method: "POST" }), "Payment link created. It expires in 24 hours.")}>
                    {o.paymentLinkUrl ? "Create a new payment link" : "Create payment link"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={{ width: 150 }}>
                    <option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="other">Other</option>
                  </Select>
                  <button onClick={() => confirm("Mark as paid? This takes stock and creates the order.") && run(() => api(`/drafts/${id}/mark-paid`, { method: "POST", json: { method: payMethod, notify: notify && !!o.customer?.email } }), notify && o.customer?.email ? "Order created. Confirmation emailed." : "Order created.")}>Mark as paid</button>
                </div>
              </div>
              {!!o.customer?.email && (
                <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />Email an order confirmation to {o.customer.email} when marked as paid</label>
              )}
              {o.paymentLinkUrl && (
                <div className="field" style={{ marginTop: 12 }}>
                  <label>Payment link</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input readOnly value={o.paymentLinkUrl} onFocus={(e) => e.target.select()} />
                    <button onClick={() => navigator.clipboard.writeText(o.paymentLinkUrl!).then(() => setMsg("Link copied"))}>Copy</button>
                    <button className="primary" disabled={!o.customer?.email} title={o.customer?.email ? "" : "Add a customer email first"} onClick={() => run(() => api(`/drafts/${id}/email-payment-link`, { method: "POST" }), `Payment link emailed to ${o.customer?.email}`)}>Email to customer</button>
                  </div>
                </div>
              )}
              <p style={{ marginTop: 12 }}>
                <Link href={`/admin/orders/${id}/edit`} className="btn-link">Edit draft</Link>{" "}
                <button onClick={() => confirm("Delete this draft?") && run(async () => { await api(`/drafts/${id}`, { method: "DELETE" }); router.push("/admin/orders?status=draft"); })}>Delete draft</button>
              </p>
            </div>
          ) : (
            <div className="card">
              <h3>Shipping &amp; tracking</h3>
              <div className="row">
                <div className="field"><label>Carrier</label>
                  <Select value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })}>
                    <option value="">Select…</option>{carriers.map((c) => <option key={c.name}>{c.name}</option>)}
                  </Select>
                </div>
                <div className="field"><label>Tracking number</label><input value={ship.trackingNumber} onChange={(e) => setShip({ ...ship, trackingNumber: e.target.value })} /></div>
                <div className="field"><label>Package weight (g)</label><input type="number" min={0} value={ship.weight} onChange={(e) => setShip({ ...ship, weight: e.target.value })} /></div>
              </div>
              {o.trackingNumber && trackingUrl(o.carrier, o.trackingNumber) && <p><a className="lnk" href={trackingUrl(o.carrier, o.trackingNumber)!} target="_blank" rel="noreferrer">Track package<External /></a></p>}
              <div className="actions">
                <button onClick={() => patch(shipBody(), "Tracking saved")}>Save tracking</button>
                <Link className="btn-link" href={`/admin/orders/${id}/label`} target="_blank">Print shipping label</Link>
                <Link className="btn-link" href={`/admin/orders/${id}/label?type=slip`} target="_blank">Print packing slip</Link>
                {o.status === "open" && <button className="primary" disabled={!paid} title={paid ? "" : "Order is not paid"} onClick={() => { if (o.riskLevel === "high" && !confirm("This order is flagged HIGH fraud risk. Ship it anyway?")) return; patch({ ...shipBody(), status: "fulfilled" }, "Marked as fulfilled"); }}>Mark as fulfilled</button>}
                {o.status === "fulfilled" && <button onClick={() => patch({ status: "open" }, "Marked as unfulfilled")}>Mark unfulfilled</button>}
                {o.status === "open" && <button onClick={() => confirm("Cancel this order? Refunds are done in Stripe.") && patch({ status: "cancelled" })}>Cancel order</button>}
              </div>
              {o.shippedAt && <p className="muted">Fulfilled {new Date(o.shippedAt).toLocaleString()}</p>}
            </div>
          )}

          {!isDraft && paid && o.status !== "cancelled" && o.items.some((i) => i.physical) && <ShippingLabel orderId={id} weightG={ship.weight} tick={emailTick} onChanged={(m) => run(async () => {}, m)} />}

          {!isDraft && <RefundCard order={o} onDone={() => run(async () => {}, "Refund recorded")} />}

          <OrderEmails orderId={id} paid={paid} hasEmail={!!o.customer?.email} tick={emailTick} onChanged={() => setEmailTick((t) => t + 1)} />
        </div>

        <div>
          <div className="card">
            <h3>Customer</h3>
            <div>{o.customer?.name}</div>
            <div className="muted">{o.customer?.email}</div>
            {o.customer?.phone && <div className="muted">{o.customer.phone}</div>}
          </div>
          <div className="card">
            <h3>Ship to</h3>
            <div>{o.shippingName}</div>
            <div>{addr.line1}</div>{addr.line2 && <div>{addr.line2}</div>}
            <div>{addr.city}{region ? `, ${region}` : ""} {addr.postcode}</div>
            <div className="muted">{addr.country}</div>
          </div>
          <div className="card">
            <h3>Notes &amp; tags</h3>
            <div className="field"><label>Tags (comma separated)</label>
              <input defaultValue={o.tags.join(", ")} onBlur={(e) => patch({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} disabled={isDraft} />
            </div>
            <div className="field"><label>Internal notes</label>
              <textarea rows={3} defaultValue={o.notes} onBlur={(e) => patch({ notes: e.target.value })} disabled={isDraft} />
            </div>
            {isDraft && <p className="muted">Edit notes and tags in the draft editor.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
