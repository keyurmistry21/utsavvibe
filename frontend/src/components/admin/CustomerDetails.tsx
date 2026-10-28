"use client";

import { useState } from "react";
import { api, money, type CustomerRow } from "@/lib/api";
import { Drawer } from "./Drawer";

export function CustomerDetails({ customer, onSaved, onClose }: { customer: CustomerRow; onSaved: () => void; onClose: () => void }) {
  const [tags, setTags] = useState(customer.tags.join(", "));
  const [notes, setNotes] = useState(customer.notes);
  const [taxExempt, setTaxExempt] = useState(customer.taxExempt);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const spent = Object.entries(customer.spent).map(([cur, v]) => money(v, cur)).join(" + ") || "—";

  const save = async () => {
    setSaving(true); setErr("");
    try {
      await api(`/customers/${customer.id}`, { method: "PATCH", json: { tags: tags.split(",").map((t) => t.trim()).filter(Boolean), notes, taxExempt } });
      onSaved();
    } catch (e) { setErr((e as Error).message); setSaving(false); }
  };

  return (
    <Drawer
      title={customer.name || customer.email || customer.phone || "Customer"}
      onClose={onClose}
      dismissOnScrim={false}
      footer={
        <>
          {err ? <span className="error" style={{ margin: 0 }}>{err}</span> : <span />}
          <span style={{ display: "flex", gap: 12 }}><button onClick={onClose}>Close</button><button className="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button></span>
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
        <h3>Details</h3>
        <label className="check"><input type="checkbox" checked={taxExempt} onChange={(e) => setTaxExempt(e.target.checked)} />Don’t collect tax for this customer</label>
        <div className="field" style={{ marginTop: 16 }}><label>Tags (comma separated)</label><input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
        <div className="field"><label>Notes</label><textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
    </Drawer>
  );
}
