"use client";

import { useUnsavedGuard } from "./unsaved";
import { useState } from "react";
import { api, money, type CustomerRow } from "@/lib/api";
import Link from "next/link";
import { Drawer } from "./Drawer";
import { Badge, useApi } from "./hooks";

type Purchase = { id: string; number: number; createdAt: string; status: string; paymentStatus: string; total: number; currency: string; channel: string; market: string; items: { title: string; quantity: number; unitPrice: number }[] };

export function CustomerDetails({ customer, onSaved, onClose }: { customer: CustomerRow; onSaved: () => void; onClose: () => void }) {
  const [tags, setTags] = useState(customer.tags.join(", "));
  const [notes, setNotes] = useState(customer.notes);
  const [taxExempt, setTaxExempt] = useState(customer.taxExempt);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: purchases } = useApi<Purchase[]>(`/customers/${customer.id}/purchases`);
  const spent = Object.entries(customer.spent).map(([cur, v]) => money(v, cur)).join(" + ") || "—";

  const dirty = tags !== customer.tags.join(", ") || notes !== customer.notes || taxExempt !== customer.taxExempt;
  const save = async (): Promise<boolean> => {
    setSaving(true); setErr("");
    try {
      await api(`/customers/${customer.id}`, { method: "PATCH", json: { tags: tags.split(",").map((t) => t.trim()).filter(Boolean), notes, taxExempt } });
      allow();
      onSaved();
      return true;
    } catch (e) { setErr((e as Error).message); setSaving(false); return false; }
  };
  const { guard, allow } = useUnsavedGuard(dirty, save);
  const close = () => { if (dirty && !confirm("Discard your changes?")) return; allow(); onClose(); };

  return (
    <>
    {guard}
    <Drawer
      title={customer.name || customer.email || customer.phone || "Customer"}
      onClose={close}
      dismissOnScrim={false}
      footer={
        <>
          {err ? <span className="error" style={{ margin: 0 }}>{err}</span> : <span />}
          <span style={{ display: "flex", gap: 12 }}><button onClick={close}>Close</button><button className="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button></span>
        </>
      }
    >
      <div className="card">
        <h3>Contact</h3>
        <div>{customer.email ?? <span className="muted">No email</span>}</div>
        <div>{customer.phone ?? <span className="muted">No phone</span>}</div>
        <div className="muted">{customer.location || "No address"}{customer.postcode ? ` · ${customer.postcode}` : ""}</div>
      </div>
      <div className="card">
        <h3>Activity</h3>
        <div className="payrow"><span>Orders</span><span>{customer.orderCount}</span></div>
        <div className="payrow"><span>Amount spent</span><span>{spent}</span></div>
        <div className="payrow"><span>Customer since</span><span>{new Date(customer.createdAt).toLocaleDateString()}</span></div>
      </div>
      <div className="card">
        <h3>Purchases{purchases ? ` (${purchases.length})` : ""}</h3>
        {purchases && !purchases.length && <p className="muted">No orders yet.</p>}
        {purchases?.map((o) => (
          <div key={o.id} className="purch">
            <div className="payrow"><Link className="lnk" href={`/admin/orders/${o.id}`}>#{o.number}</Link><span>{money(o.total, o.currency)}</span></div>
            <div className="muted">{new Date(o.createdAt).toLocaleDateString()} · {o.market} · {o.channel === "in_store" ? "In-store" : "Online"} <Badge value={o.paymentStatus} /> <Badge value={o.status} /></div>
            <ul>{o.items.map((i, n) => <li key={n}>{i.quantity} × {i.title} <span className="muted">{money(i.unitPrice, o.currency)}</span></li>)}</ul>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Details</h3>
        <label className="check"><input type="checkbox" checked={taxExempt} onChange={(e) => setTaxExempt(e.target.checked)} />Don’t collect tax for this customer</label>
        <div className="field" style={{ marginTop: 16 }}><label>Tags (comma separated)</label><input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
        <div className="field"><label>Notes</label><textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
    </Drawer>
    </>
  );
}
