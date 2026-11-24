"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "./hooks";
import { Modal } from "./Modal";
import { Select } from "../Select";

type C = { id: string; name: string; channel: "email" | "sms"; subject: string; body: string; audience: string; status: "draft" | "sending" | "sent"; sentCount: number; failedCount: number; createdAt: string; sentAt: string | null };
type Form = { id?: string; name: string; channel: "email" | "sms"; subject: string; body: string; audience: string };
const blank: Form = { name: "", channel: "email", subject: "", body: "", audience: "all" };

export function Campaigns() {
  const { data, error, reload } = useApi<{ emailReady: boolean; smsReady: boolean; campaigns: C[] }>("/campaigns");
  const [edit, setEdit] = useState<Form | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const sending = data?.campaigns.some((c) => c.status === "sending");
  useEffect(() => { if (!sending) return; const t = setInterval(reload, 3000); return () => clearInterval(t); }, [sending, reload]);

  const send = async (c: C) => {
    if (!confirm(`Send "${c.name}" now? Customers can't be un-emailed.`)) return;
    setErr(""); setMsg("");
    try { const r = await api<{ queued: number }>(`/campaigns/${c.id}/send`, { method: "POST" }); setMsg(`Sending to ${r.queued} ${r.queued === 1 ? "person" : "people"}…`); reload(); } catch (e) { setErr((e as Error).message); }
  };
  const del = async (c: C) => { if (!confirm(`Delete "${c.name}"?`)) return; try { await api(`/campaigns/${c.id}`, { method: "DELETE" }); reload(); } catch (e) { setErr((e as Error).message); } };

  return (
    <>
      <div className="pagehead"><div><h2>Campaigns</h2><div className="muted">Email and text messages to customers who agreed to receive them. Everyone else is skipped.</div></div><button className="primary" onClick={() => setEdit({ ...blank })}>Create campaign</button></div>
      {data && !data.emailReady && <div className="notice" style={{ marginBottom: 12 }}>Email isn&apos;t set up yet. Add <code>SMTP_HOST</code> (and the other <code>SMTP_*</code> values) to <code>backend/.env</code>.</div>}
      {data && !data.smsReady && <div className="notice" style={{ marginBottom: 12 }}>Text messages are off. To turn them on, add <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code> and <code>TWILIO_FROM</code> to <code>backend/.env</code>. Send yourself a test first.</div>}
      {(error || err) && <div className="error">{error || err}</div>}
      {msg && <div className="okmsg">{msg}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Campaign</th><th>Channel</th><th>Audience</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data?.campaigns.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b><div className="muted">{c.channel === "email" ? c.subject : c.body.slice(0, 60)}</div></td>
                <td>{c.channel === "email" ? "Email" : "Text"}</td>
                <td>{c.audience === "all" ? "Everyone who opted in" : c.audience === "buyers" ? "Customers who bought" : c.audience.startsWith("tag:") ? `Tag “${c.audience.slice(4)}”` : `Bought in ${c.audience.slice(7).toUpperCase()}`}</td>
                <td><span className={`badge ${c.status === "sent" ? "good" : c.status === "sending" ? "warn" : ""}`}>{c.status === "sent" ? `Sent · ${c.sentCount}${c.failedCount ? ` (${c.failedCount} failed)` : ""}` : c.status === "sending" ? `Sending… ${c.sentCount}` : "Draft"}</span></td>
                <td className="r">{c.status === "draft" && <><button className="link" onClick={() => setEdit({ id: c.id, name: c.name, channel: c.channel, subject: c.subject, body: c.body, audience: c.audience })}>Edit</button>{" "}<button className="link" onClick={() => send(c)}>Send</button>{" "}</>}{c.status !== "sending" && <button className="link" onClick={() => del(c)}>Delete</button>}</td>
              </tr>
            ))}
            {data && !data.campaigns.length && <tr><td colSpan={5}>No campaigns yet. Tell customers about Diwali, new arrivals, or a discount code.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <Editor f={edit} ready={data ? { email: data.emailReady, sms: data.smsReady } : { email: false, sms: false }} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function Editor({ f: init, ready, onClose, onSaved }: { f: Form; ready: { email: boolean; sms: boolean }; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(init);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [phone, setPhone] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((c) => ({ ...c, [k]: v }));
  useEffect(() => { api<{ count: number }>(`/campaigns/audience?channel=${f.channel}&audience=${encodeURIComponent(f.audience)}`).then((r) => setCount(r.count)).catch(() => setCount(null)); }, [f.channel, f.audience]);

  const save = async (): Promise<string | null> => {
    setErr("");
    try { const r = await api<{ id: string }>(f.id ? `/campaigns/${f.id}` : "/campaigns", { method: f.id ? "PUT" : "POST", json: f }); return r.id; }
    catch (e) { const m = (e as Error).message; setErr(m === "validation" ? "Check the name, subject and message (texts: under 320 characters)." : m); return null; }
  };
  const test = async () => {
    setNote(""); const id = await save(); if (!id) return;
    setF((c) => ({ ...c, id }));
    try { const r = await api<{ sent: boolean; note: string }>(`/campaigns/${id}/test`, { method: "POST", json: { phone } }); setNote(r.note); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <Modal title={f.id ? "Edit campaign" : "Create campaign"} onClose={onClose} wide dismissOnScrim={false}
      footer={<><span /><span style={{ display: "flex", gap: 8 }}><button onClick={onClose}>Cancel</button><button className="primary" onClick={async () => { if (await save()) onSaved(); }}>Save draft</button></span></>}>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <div className="field"><label htmlFor="cp-name">Name (only you see it)</label><input id="cp-name" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></div>
        <div className="field"><label>Send as</label><Select value={f.channel} onChange={(e) => set("channel", e.target.value as Form["channel"])}><option value="email">Email</option><option value="sms">Text message</option></Select></div>
      </div>
      {f.channel === "email" && <div className="field"><label htmlFor="cp-sub">Subject</label><input id="cp-sub" value={f.subject} onChange={(e) => set("subject", e.target.value)} /></div>}
      <div className="field"><label htmlFor="cp-body">Message</label><textarea id="cp-body" rows={f.channel === "sms" ? 4 : 8} value={f.body} onChange={(e) => set("body", e.target.value)} placeholder={f.channel === "sms" ? "Short and clear. We add “reply STOP to opt out”." : "Plain text. Leave a blank line between paragraphs. An unsubscribe link is added for you."} />
        {f.channel === "sms" && <div className="muted">{f.body.length}/320</div>}</div>
      <div className="field"><label>Send to</label>
        <Select value={f.audience.startsWith("tag:") ? "tag" : f.audience.startsWith("market:") ? "market" : f.audience} onChange={(e) => set("audience", e.target.value === "tag" ? "tag:vip" : e.target.value === "market" ? "market:UK" : e.target.value)}>
          <option value="all">Everyone who opted in</option><option value="buyers">Customers who have bought</option><option value="tag">Customers with a tag…</option><option value="market">Customers who bought in a market…</option>
        </Select>
        {f.audience.startsWith("tag:") && <input style={{ marginTop: 8 }} value={f.audience.slice(4)} onChange={(e) => set("audience", `tag:${e.target.value.replace(/\s/g, "")}`)} aria-label="Tag" />}
        {f.audience.startsWith("market:") && <Select value={f.audience.slice(7)} onChange={(e) => set("audience", `market:${e.target.value}`)}>{["UK", "US", "CA"].map((m) => <option key={m}>{m}</option>)}</Select>}
        <div className="muted">{count == null ? "" : `${count} ${count === 1 ? "person" : "people"} will get this (opted in only).`}</div>
      </div>
      <div className="field"><label>Send yourself a test</label>
        <div className="row">
          {f.channel === "sms" && <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+14165550123" aria-label="Your phone number" />}
          <button onClick={test} disabled={f.channel === "email" ? !ready.email : !ready.sms}>{f.channel === "email" ? "Email me a test" : "Text me a test"}</button>
        </div>
        {note && <div className="muted">{note}</div>}
      </div>
    </Modal>
  );
}
