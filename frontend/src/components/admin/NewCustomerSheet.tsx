"use client";

import { useState } from "react";
import { api, hasAddress, type Address, type Customer, type Market } from "@/lib/api";
import { countryName } from "@/lib/countries";
import { AddressModal } from "./AddressModal";
import { Drawer } from "./Drawer";
import { PhoneInput } from "./PhoneInput";
import { Plus } from "../Icons";

const LANGUAGES = [["en", "English [Default]"], ["fr", "French"], ["hi", "Hindi"], ["gu", "Gujarati"]] as const;

// Full-screen "New customer" page (opens over the current page, like Shopify).
export function NewCustomerSheet({ markets, query = "", onCreated, onClose }: {
  markets: Market[];
  query?: string;
  onCreated: (c: Customer) => void;
  onClose: () => void;
}) {
  const q = query.trim();
  const [f, setF] = useState({
    firstName: q && !q.includes("@") && !/^\+?\d/.test(q) ? q.split(" ")[0] : "",
    lastName: q && !q.includes("@") && !/^\+?\d/.test(q) ? q.split(" ").slice(1).join(" ") : "",
    email: q.includes("@") ? q : "",
    phone: /^\+?\d[\d\s-]*$/.test(q) ? q : "",
    language: "en", acceptsEmail: false, acceptsSms: false, acceptsWhatsapp: false, taxExempt: false, notes: "",
  });
  const [address, setAddress] = useState<Address | null>(null);
  const [addrOpen, setAddrOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k: "firstName" | "lastName" | "email" | "notes") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const addTag = () => {
    const t = tagText.trim().replace(/,$/, "");
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagText("");
  };

  const save = async () => {
    setErr(""); setSaving(true);
    try {
      const c = await api<Customer>("/customers", { method: "POST", json: { ...f, address, tags } });
      onCreated(c);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  const hasEmail = !!f.email.trim();
  const hasPhone = !!f.phone.trim();

  return (
    <>
      <Drawer
        title="New customer"
        dismissOnScrim={false}
        onClose={() => { if (!addrOpen) onClose(); }}
        footer={
          <>
            {err ? <span className="error" style={{ margin: 0 }}>{err}</span> : <span />}
            <span style={{ display: "flex", gap: 12 }}>
              <button onClick={onClose}>Discard</button>
              <button className="primary" disabled={saving || (!hasEmail && !hasPhone)} title={!hasEmail && !hasPhone ? "Add an email or phone number" : ""} onClick={save}>{saving ? "Saving…" : "Save"}</button>
            </span>
          </>
        }
      >
        <div className="custform">
          <div>
            <h3 className="sheet-h">Customer overview</h3>
            <div className="card">
              <div className="row">
                <div className="field"><label>First name</label><input autoFocus value={f.firstName} onChange={set("firstName")} autoComplete="off" /></div>
                <div className="field"><label>Last name</label><input value={f.lastName} onChange={set("lastName")} autoComplete="off" /></div>
              </div>
              <div className="field"><label>Language</label>
                <select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
                  {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <div className="muted">This customer will receive notifications in this language.</div>
              </div>
              <div className="field"><label>Email</label><input type="email" value={f.email} onChange={set("email")} autoComplete="off" /></div>
              <div className="field"><label>Phone number</label><PhoneInput value={f.phone} onChange={(v) => setF((cur) => ({ ...cur, phone: v }))} /></div>
              <label className={`check ${hasEmail ? "" : "off"}`}><input type="checkbox" disabled={!hasEmail} checked={f.acceptsEmail && hasEmail} onChange={(e) => setF({ ...f, acceptsEmail: e.target.checked })} />Customer agreed to receive marketing emails.</label>
              <label className={`check ${hasPhone ? "" : "off"}`}><input type="checkbox" disabled={!hasPhone} checked={f.acceptsSms && hasPhone} onChange={(e) => setF({ ...f, acceptsSms: e.target.checked })} />Customer agreed to receive SMS marketing text messages.</label>
              <label className={`check ${hasPhone ? "" : "off"}`}><input type="checkbox" disabled={!hasPhone} checked={f.acceptsWhatsapp && hasPhone} onChange={(e) => setF({ ...f, acceptsWhatsapp: e.target.checked })} />Customer agreed to receive WhatsApp marketing messages.</label>
              <div className="graynote">You should ask your customers for permission before you subscribe them to your marketing emails, SMS, or WhatsApp messages.</div>
            </div>

            <h3 className="sheet-h">Default address</h3>
            <p className="muted" style={{ marginTop: -6 }}>The primary address of this customer</p>
            <div className="card addrcard">
              {address && hasAddress(address) ? (
                <div className="addrsum">
                  <div>
                    {(address.firstName || address.lastName) && <div>{`${address.firstName} ${address.lastName}`.trim()}</div>}
                    {address.company && <div>{address.company}</div>}
                    <div>{address.line1}{address.line2 ? `, ${address.line2}` : ""}</div>
                    <div>{address.city}{address.region ? `, ${address.region}` : ""} {address.postcode}</div>
                    <div>{countryName(address.country)}</div>
                    {address.phone && <div className="muted">{address.phone}</div>}
                  </div>
                  <div><button onClick={() => setAddrOpen(true)}>Edit</button> <button className="link" onClick={() => setAddress(null)}>Remove</button></div>
                </div>
              ) : (
                <button className="addrow" onClick={() => setAddrOpen(true)}><Plus />Add address<span className="chev">›</span></button>
              )}
            </div>

            <h3 className="sheet-h">Tax details</h3>
            <div className="card">
              <div className="field" style={{ margin: 0 }}><label>Tax settings</label>
                <select value={f.taxExempt ? "exempt" : "collect"} onChange={(e) => setF({ ...f, taxExempt: e.target.value === "exempt" })}>
                  <option value="collect">Collect tax</option>
                  <option value="exempt">Don’t collect tax</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <h3 className="sheet-h">Notes</h3>
            <div className="card">
              <textarea rows={3} value={f.notes} onChange={set("notes")} placeholder="Notes are private and won’t be shared with the customer." />
            </div>
            <h3 className="sheet-h">Tags</h3>
            <div className="card">
              <input value={tagText} placeholder="Add tags" onChange={(e) => setTagText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }} onBlur={addTag} />
              <div style={{ marginTop: 8 }}>
                {tags.map((t) => <span key={t} className="chip">{t} <button className="link" aria-label={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>✕</button></span>)}
              </div>
            </div>
          </div>
        </div>
      </Drawer>
      {addrOpen && (
        <AddressModal
          title="Add default address"
          initial={address ?? { country: "", firstName: f.firstName, lastName: f.lastName, company: "", line1: "", line2: "", city: "", region: "", postcode: "", phone: f.phone }}
          markets={markets}
          onSave={(a) => { setAddress(a); setAddrOpen(false); }}
          onClose={() => setAddrOpen(false)}
        />
      )}
    </>
  );
}
