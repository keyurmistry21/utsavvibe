"use client";

import { useEffect, useState } from "react";
import { api, auth } from "@/lib/api";

const blankFrom = { name: "", company: "", line1: "", line2: "", city: "", region: "", postcode: "", country: "", phone: "" };

function ShipFrom() {
  const [f, setF] = useState(blankFrom);
  const [msg, setMsg] = useState("");
  useEffect(() => { api<typeof blankFrom>("/settings/ship-from").then(setF).catch(() => {}); }, []);
  const set = (k: keyof typeof blankFrom) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
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
        <div className="field"><label>Address</label><input value={f.line1} onChange={set("line1")} /></div>
        <div className="field"><label>Apartment, suite</label><input value={f.line2} onChange={set("line2")} /></div>
      </div>
      <div className="row">
        <div className="field"><label>City</label><input value={f.city} onChange={set("city")} /></div>
        <div className="field"><label>Province / state</label><input value={f.region} onChange={set("region")} /></div>
        <div className="field"><label>Postcode</label><input value={f.postcode} onChange={set("postcode")} /></div>
        <div className="field"><label>Country</label><input value={f.country} maxLength={2} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} /></div>
      </div>
      <div className="field" style={{ maxWidth: 260 }}><label>Phone</label><input value={f.phone} onChange={set("phone")} /></div>
      {msg && <div className="muted">{msg}</div>}
      <button className="primary" onClick={save}>Save address</button>
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

  const save = async () => {
    setMsg(null);
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
        <div className="field"><label>Current password</label><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="field"><label>New password (10+ characters)</label><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        {msg && <div className={msg.ok ? "muted" : "error"}>{msg.text}</div>}
        <button className="primary" disabled={!current || next.length < 10} onClick={save}>Update password</button>
      </div>
      <ShipFrom />
      <EmailSettings />
    </>
  );
}
