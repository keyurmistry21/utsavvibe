"use client";

import { useDirty, useUnsavedGuard } from "./unsaved";
import { useEffect, useState } from "react";
import { api, hasAddress, type Address, type Customer, type Market } from "@/lib/api";
import { countryName } from "@/lib/countries";
import { email as emailErr, maxLen, phone as phoneErr } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { AddressModal } from "./AddressModal";
import { PhoneInput } from "./PhoneInput";
import { ArrowLeft, Plus } from "../Icons";
import { Select } from "../Select";

const LANGUAGES = [["en", "English [Default]"], ["fr", "French"], ["hi", "Hindi"], ["gu", "Gujarati"]] as const;

// "New customer" page. Rendered in the main panel in place of the page that opened it (sidebar stays visible).
export function NewCustomerSheet({ markets, query = "", backLabel = "Back", onCreated, onClose }: {
  markets: Market[];
  query?: string;
  backLabel?: string;
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

  const [srvEmail, setSrvEmail] = useState("");
  const E: Record<string, string> = {
    firstName: maxLen(f.firstName, 100, "First name"),
    lastName: maxLen(f.lastName, 100, "Last name"),
    email: emailErr(f.email) || srvEmail,
    phone: phoneErr(f.phone),
    contact: !f.email.trim() && !f.phone.trim() ? "Add an email address or a phone number so you can reach this customer" : "",
  };
  const val = useValidation(E);

  const { dirty } = useDirty({ f, address, tags });
  const save = async (): Promise<boolean> => {
    if (!val.submit()) return false;
    setErr(""); setSaving(true);
    try {
      const c = await api<Customer>("/customers", { method: "POST", json: { ...f, address, tags } });
      allow();
      onCreated(c);
      return true;
    } catch (e) {
      const msg = (e as Error).message;
      if (/email/i.test(msg)) setSrvEmail(msg); else setErr(msg);
      setSaving(false);
      return false;
    }
  };
  const { guard, allow } = useUnsavedGuard(dirty, save);
  const cancel = () => { if (dirty && !confirm("Discard your changes?")) return; allow(); onClose(); };

  useEffect(() => { document.querySelector("main.content")?.scrollTo({ top: 0 }); }, []);

  const hasEmail = !!f.email.trim();
  const hasPhone = !!f.phone.trim();

  return (
    <>
      {guard}
      <div className="crumbbar"><button className="link crumb" onClick={cancel}><ArrowLeft />{backLabel}</button></div>
      <div className="pagehead"><h2>New customer</h2></div>
      {err && <div className="error">{err}</div>}
      <div className="cols">
          <div>
            <h3 className="sheet-h">Customer overview</h3>
            <div className="card">
              <div className="row">
                <div className="field"><label htmlFor="nc-first">First name</label><input id="nc-first" autoFocus value={f.firstName} onChange={set("firstName")} autoComplete="off" {...val.props("firstName")} /><FieldError k="firstName" msg={val.err("firstName")} /></div>
                <div className="field"><label htmlFor="nc-last">Last name</label><input id="nc-last" value={f.lastName} onChange={set("lastName")} autoComplete="off" {...val.props("lastName")} /><FieldError k="lastName" msg={val.err("lastName")} /></div>
              </div>
              <div className="field"><label>Language</label>
                <Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
                  {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
                <div className="muted">This customer will receive notifications in this language.</div>
              </div>
              <div className="field"><label htmlFor="nc-email">Email</label><input id="nc-email" type="email" value={f.email} onChange={(e) => { setSrvEmail(""); set("email")(e); }} autoComplete="off" aria-invalid={val.err("email") || val.err("contact") ? true : undefined} onBlur={() => { val.touch("email"); val.touch("contact"); }} /><FieldError k="email" msg={val.err("email") || val.err("contact")} /></div>
              <div className="field"><label htmlFor="nc-phone">Phone number</label><PhoneInput id="nc-phone" value={f.phone} onChange={(v) => setF((cur) => ({ ...cur, phone: v }))} invalid={!!(val.err("phone") || val.err("contact"))} onTouch={() => { val.touch("phone"); val.touch("contact"); }} /><FieldError k="phone" msg={val.err("phone")} /></div>
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
                <Select value={f.taxExempt ? "exempt" : "collect"} onChange={(e) => setF({ ...f, taxExempt: e.target.value === "exempt" })}>
                  <option value="collect">Collect tax</option>
                  <option value="exempt">Don’t collect tax</option>
                </Select>
              </div>
            </div>
          </div>

          <aside className="sideform">
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
          </aside>
      </div>

      <div className="savebar">
        <span style={{ flex: 1 }} />
        <button onClick={cancel}>Discard</button>
        <button className="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      </div>
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
