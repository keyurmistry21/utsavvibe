"use client";

import { useUnsavedGuard } from "./unsaved";
import { useRef, useState } from "react";
import { api, blankAddress, money, type Address, type Customer, type CustomerRow, type Market } from "@/lib/api";
import { email as emailErr, phone as phoneErr } from "@/lib/validators";
import { AddressModal } from "./AddressModal";
import Link from "next/link";
import { Drawer } from "./Drawer";
import { Badge, useApi } from "./hooks";

type Purchase = { id: string; number: number; createdAt: string; status: string; paymentStatus: string; total: number; currency: string; channel: string; market: string; items: { title: string; quantity: number; unitPrice: number }[] };

export function CustomerDetails({ customer, onSaved, onClose }: { customer: CustomerRow; onSaved: () => void; onClose: () => void }) {
  const [first, setFirst] = useState(customer.firstName);
  const [last, setLast] = useState(customer.lastName);
  const [email, setEmail] = useState(customer.email ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [subEmail, setSubEmail] = useState(customer.acceptsEmail);
  const [subSms, setSubSms] = useState(customer.acceptsSms);
  const [subWa, setSubWa] = useState(customer.acceptsWhatsapp);
  const [tags, setTags] = useState(customer.tags.join(", "));
  const [notes, setNotes] = useState(customer.notes);
  const [taxExempt, setTaxExempt] = useState(customer.taxExempt);
  const [address, setAddress] = useState<Address | null | undefined>(undefined); // undefined until the full record has loaded
  const [addrOpen, setAddrOpen] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: full } = useApi<Customer>(`/customers/${customer.id}`);
  const { data: markets } = useApi<Market[]>("/markets");
  const startAddr = useRef<string | null>(null);
  if (full && startAddr.current === null) { startAddr.current = JSON.stringify(full.address ?? null); if (address === undefined) setAddress((full.address as Address | null) ?? null); }
  const { data: purchases } = useApi<Purchase[]>(`/customers/${customer.id}/purchases`);
  const spent = Object.entries(customer.spent).map(([cur, v]) => money(v, cur)).join(" + ") || "—";

  const eErr = emailErr(email), pErr = phoneErr(phone);
  const noContact = !email.trim() && !phone.trim();
  const dirty = first !== customer.firstName || last !== customer.lastName || email !== (customer.email ?? "") || phone !== (customer.phone ?? "") || subEmail !== customer.acceptsEmail || subSms !== customer.acceptsSms || subWa !== customer.acceptsWhatsapp
    || tags !== customer.tags.join(", ") || notes !== customer.notes || taxExempt !== customer.taxExempt || (startAddr.current !== null && JSON.stringify(address ?? null) !== startAddr.current);
  const save = async (): Promise<boolean> => {
    if (eErr || pErr || noContact) { setErr(eErr || pErr || "Keep an email address or a phone number so you can reach this customer"); return false; }
    setSaving(true); setErr("");
    try {
      await api(`/customers/${customer.id}`, { method: "PATCH", json: {
        firstName: first.trim(), lastName: last.trim(), email: email.trim(), phone: phone.trim(), acceptsEmail: subEmail, acceptsSms: subSms, acceptsWhatsapp: subWa,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean), notes, taxExempt, ...(address !== undefined ? { address } : {}),
      }, toast: "Customer saved" });
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
        <div className="row">
          <div className="field"><label htmlFor="cd-first">First name</label><input id="cd-first" value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" /></div>
          <div className="field"><label htmlFor="cd-last">Last name</label><input id="cd-last" value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" /></div>
        </div>
        <div className="field"><label htmlFor="cd-email">Email</label><input id="cd-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!eErr || undefined} />{eErr && <div className="fielderr" role="alert">{eErr}</div>}</div>
        <div className="field"><label htmlFor="cd-phone">Phone</label><input id="cd-phone" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!pErr || undefined} />{pErr && <div className="fielderr" role="alert">{pErr}</div>}</div>
        <div className="field" style={{ marginBottom: 6 }}><label>Address</label>
          <div className="cd-addr">
            <span>{address === undefined ? "Loading…" : address && (address.line1 || address.city) ? [address.line1, address.line2, [address.city, address.region, address.postcode].filter(Boolean).join(", "), address.country].filter(Boolean).join(" · ") : <span className="muted">No address</span>}</span>
            <button type="button" className="link" disabled={address === undefined || !markets} onClick={() => setAddrOpen(true)}>{address && (address.line1 || address.city) ? "Edit address" : "Add address"}</button>
          </div>
        </div>
        <div className="cd-subs">
          <label className="check"><input type="checkbox" checked={subEmail && !!email.trim()} disabled={!email.trim()} onChange={(e) => setSubEmail(e.target.checked)} />Agreed to marketing emails</label>
          <label className="check"><input type="checkbox" checked={subSms && !!phone.trim()} disabled={!phone.trim()} onChange={(e) => setSubSms(e.target.checked)} />Agreed to texts</label>
          <label className="check"><input type="checkbox" checked={subWa && !!phone.trim()} disabled={!phone.trim()} onChange={(e) => setSubWa(e.target.checked)} />Agreed to WhatsApp</label>
        </div>
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
    {addrOpen && markets && <AddressModal title="Customer address" initial={address ?? blankAddress()} markets={markets} onSave={(a) => { setAddress(a); setAddrOpen(false); }} onClose={() => setAddrOpen(false)} />}
    </>
  );
}
