"use client";

import { useEffect, useState } from "react";
import { api, auth } from "@/lib/api";
import { FIELD_STYLES, getFieldStyle, setFieldStyle, type FieldStyleId } from "@/lib/fieldStyle";
import { maxLen, phone as phoneErr, required } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { Select } from "../Select";

const blankFrom = { name: "", company: "", line1: "", line2: "", city: "", region: "", postcode: "", country: "", phone: "" };

function ShipFrom() {
  const [f, setF] = useState(blankFrom);
  const [msg, setMsg] = useState("");
  useEffect(() => { api<typeof blankFrom>("/settings/ship-from").then(setF).catch(() => {}); }, []);
  const set = (k: keyof typeof blankFrom) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const E: Record<string, string> = {
    country: f.country && !/^[A-Z]{2}$/.test(f.country) ? "Use the 2-letter country code, like GB, US or CA" : "",
    postcode: maxLen(f.postcode, 12, "Postcode"),
    phone: phoneErr(f.phone),
    line1: maxLen(f.line1, 200, "Address"),
  };
  const val = useValidation(E);
  const save = async () => {
    if (!val.submit()) return;
    try { await api("/settings/ship-from", { method: "PUT", json: f }); setMsg("Saved"); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h3>Ship-from address</h3>
      <p className="muted">Printed on shipping labels and packing slips.</p>
      <div className="row">
        <div className="field"><label>Contact name</label><input value={f.name} onChange={set("name")} /></div>
        <div className="field"><label>Business name</label><input value={f.company} onChange={set("company")} /></div>
      </div>
      <div className="row">
        <div className="field"><label htmlFor="sf-line1">Address</label><input id="sf-line1" value={f.line1} onChange={set("line1")} {...val.props("line1")} /><FieldError k="line1" msg={val.err("line1")} /></div>
        <div className="field"><label>Apartment, suite</label><input value={f.line2} onChange={set("line2")} /></div>
      </div>
      <div className="row">
        <div className="field"><label>City</label><input value={f.city} onChange={set("city")} /></div>
        <div className="field"><label>Province / state</label><input value={f.region} onChange={set("region")} /></div>
        <div className="field"><label htmlFor="sf-post">Postcode</label><input id="sf-post" value={f.postcode} onChange={set("postcode")} {...val.props("postcode")} /><FieldError k="postcode" msg={val.err("postcode")} /></div>
        <div className="field"><label htmlFor="sf-country">Country</label><input id="sf-country" value={f.country} maxLength={2} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} {...val.props("country")} /><FieldError k="country" msg={val.err("country")} /></div>
      </div>
      <div className="field" style={{ maxWidth: 260 }}><label htmlFor="sf-phone">Phone</label><input id="sf-phone" value={f.phone} onChange={set("phone")} {...val.props("phone")} /><FieldError k="phone" msg={val.err("phone")} /></div>
      {msg && <div className="muted">{msg}</div>}
      <button className="primary" onClick={save}>Save address</button>
    </div>
  );
}

function Appearance() {
  const [cur, setCur] = useState<FieldStyleId>("filled");
  useEffect(() => { setCur(getFieldStyle()); }, []);
  const pick = (id: FieldStyleId) => { setFieldStyle(id); setCur(id); };
  return (
    <div className="card">
      <h3>Appearance: input style</h3>
      <p className="muted">How text boxes, search boxes and text areas look everywhere (admin and storefront). Click a style to try it. Your choice is saved in this browser.</p>
      <div className="fieldopts">
        {FIELD_STYLES.map((s) => (
          <div key={s.id} role="radio" tabIndex={0} aria-checked={cur === s.id} className={`fieldopt ${cur === s.id ? "on" : ""}`} onClick={() => pick(s.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(s.id); } }}>
            <span className="fieldopt-head"><b>{s.label}</b>{cur === s.id && <span className="badge good">In use</span>}</span>
            <span className="muted fieldopt-note">{s.note}</span>
            <span className="fieldpreview" data-fields={s.id}>
              <span className="searchfield"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" /></svg><input placeholder="Search customers" aria-label={`${s.label}: search sample`} /></span>
              <input placeholder="Text box" aria-label={`${s.label}: text sample`} />
              <textarea rows={2} placeholder="Text area" aria-label={`${s.label}: text area sample`} />
              <Select aria-label={`${s.label}: dropdown sample`}><option>Dropdown</option><option>Another choice</option></Select>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmailSettings() {
  const [st, setSt] = useState<{ configured: boolean; from: string | null; host: string | null; dev: boolean } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<NonNullable<typeof st>>("/settings/email-status").then(setSt).catch(() => {}); }, []);
  const test = async () => {
    setBusy(true); setMsg(null);
    try { const r = await api<{ to: string }>("/settings/email-test", { method: "POST" }); setMsg({ ok: true, text: `Test email sent to ${r.to}.` }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h3>Customer emails</h3>
      {!st ? <p className="muted">Checking…</p> : st.configured ? (
        <>
          <p>Order confirmations and payment links are sent from <b>{st.from ?? "the default sender"}</b> via <b>{st.host}</b>.</p>
          {st.dev && <p className="muted">This is the local test setup: emails are caught by a fake inbox and never reach real customers. Open it at <a className="lnk" href="http://localhost:8026" target="_blank" rel="noreferrer">localhost:8026</a>.</p>}
          {msg && <div className={msg.ok ? "okmsg" : "error"}>{msg.text}</div>}
          <button disabled={busy} onClick={test}>{busy ? "Sending…" : "Send a test email to me"}</button>
        </>
      ) : (
        <p className="muted">Email isn’t set up, so customers won’t receive anything. Add <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and <code>MAIL_FROM</code> to <code>backend/.env</code> and restart the API.</p>
      )}
    </div>
  );
}

export function Settings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const PE: Record<string, string> = {
    current: required(current, "Enter your current password"),
    next: !next ? "Enter a new password" : next.length < 10 ? `Use at least 10 characters (${next.length} so far)` : next === current ? "The new password must be different from the current one" : "",
  };
  const pv = useValidation(PE);
  const save = async () => {
    setMsg(null);
    if (!pv.submit()) return;
    try {
      await auth("/password", { method: "POST", json: { current, next } });
      setCurrent("");
      setNext("");
      setMsg({ ok: true, text: "Password updated. Other devices were signed out." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <>
      <div className="pagehead"><h2>Settings</h2></div>
      <div className="card" style={{ maxWidth: 480 }}>
        <h3>Change password</h3>
        <div className="field"><label htmlFor="pw-cur">Current password</label><input id="pw-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} {...pv.props("current")} /><FieldError k="current" msg={pv.err("current")} /></div>
        <div className="field"><label htmlFor="pw-new">New password (10+ characters)</label><input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} {...pv.props("next")} /><FieldError k="next" msg={pv.err("next")} /></div>
        {msg && <div className={msg.ok ? "muted" : "error"}>{msg.text}</div>}
        <button className="primary" onClick={save}>Update password</button>
      </div>
      <ShipFrom />
      <EmailSettings />
      <Appearance />
    </>
  );
}
