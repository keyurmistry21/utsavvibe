"use client";

import { useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import { Switch } from "./Switch";
import { CopyBox } from "./CopyBox";
import { useApi } from "./hooks";

type Info = {
  feeds: { market: string; code: string; google: string; meta: string }[];
  abandoned: { abandonedEnabled: boolean; delayHours: number };
  stats: { sent30d: number; recovered30d: number; optedIn: number };
  mailConfigured: boolean;
};
type Row = { id: string; number: number; createdAt: string; currency: string; total: number; email: string | null; name: string; consent: boolean; reminderSentAt: string | null };

export function Marketing() {
  const { data: info, error, reload } = useApi<Info>("/integrations/marketing");
  const { data: rows, reload: reloadRows } = useApi<Row[]>("/integrations/abandoned");
  const [on, setOn] = useState(false);
  const [hours, setHours] = useState("1");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => { if (info) { setOn(info.abandoned.abandonedEnabled); setHours(String(info.abandoned.delayHours)); } }, [info]);

  const save = async () => {
    const h = Number(hours);
    if (!Number.isInteger(h) || h < 1 || h > 72) return void setErr("Wait time must be a whole number of hours from 1 to 72");
    setBusy("save"); setErr(""); setMsg("");
    try { await api("/integrations/marketing", { method: "PUT", json: { abandonedEnabled: on, delayHours: h } }); setMsg("Saved"); reload(); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const send = async (id: string) => {
    setBusy(id); setErr(""); setMsg("");
    try { await api(`/integrations/abandoned/${id}/send`, { method: "POST" }); setMsg("Reminder sent"); reloadRows(); reload(); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };

  return (
    <>
      <div className="pagehead"><div><h2>Marketing</h2><div className="muted">Show your products on Google and Meta, and win back shoppers who left before paying.</div></div></div>
      {(error || err) && <div className="error">{error || err}</div>}
      {msg && <div className="okmsg">{msg}</div>}

      <div className="card" style={{ maxWidth: 860 }}>
        <h3>Product feeds</h3>
        <p className="muted" style={{ marginTop: 0 }}>One feed per market, because price, currency and shipping differ. Gift cards are left out. The feeds update on their own as you edit products.</p>
        {info?.feeds.map((f) => (
          <div key={f.code} style={{ marginBottom: 14 }}>
            <b>{f.market}</b>
            <div className="field"><label>Google Merchant Center (XML)</label><CopyBox value={f.google} label={`Google feed ${f.market}`} /></div>
            <div className="field"><label>Meta Commerce Manager (CSV)</label><CopyBox value={f.meta} label={`Meta feed ${f.market}`} /></div>
          </div>
        ))}
        <h4>How to connect</h4>
        <ol className="muted" style={{ marginTop: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li><b>Google:</b> Merchant Center → Products → Data sources → Add → Add product data → choose the country → <i>Scheduled fetch</i>, paste the XML link, fetch daily.</li>
          <li><b>Meta:</b> Commerce Manager → Catalog → Data sources → Add items → <i>Data feed</i> → <i>Scheduled feed</i>, paste the CSV link and the same currency.</li>
          <li>The links must be reachable on the internet, so they work once your store is live on its real address.</li>
        </ol>
      </div>

      <div className="card" style={{ maxWidth: 860 }}>
        <div className="cardhead">
          <span><h3 style={{ margin: 0 }}>Abandoned checkout emails</h3><div className="muted">Email shoppers who started paying and stopped, with a link that refills their cart.</div></span>
          <Switch checked={on} onChange={setOn} label="Send abandoned checkout emails" />
        </div>
        {info && !info.mailConfigured && <div className="error">Email isn't set up (no <code>SMTP_HOST</code> in <code>backend/.env</code>), so reminders can't be sent yet.</div>}
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="mk-hours">Send after (hours)</label>
          <input id="mk-hours" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
        <p className="muted">Only customers who ticked the "email me about my cart" box at checkout get a reminder, one per checkout, with an unsubscribe link. Shoppers who bought something else since are skipped.</p>
        <button className="primary" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
        {info && (
          <div className="kv" style={{ marginTop: 14 }}><span>Last 30 days</span><b>{info.stats.sent30d} sent · {info.stats.recovered30d} recovered · {info.stats.optedIn} customers opted in</b></div>
        )}
      </div>

      <div className="card">
        <h3>Recent abandoned checkouts</h3>
        <div className="tablescroll">
          <table>
            <thead><tr><th>Order</th><th>Started</th><th>Customer</th><th>Total</th><th>Wants reminders</th><th>Reminder</th></tr></thead>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.id}>
                  <td>#{r.number}</td>
                  <td>{new Date(r.createdAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td>{r.name || r.email || "—"}<div className="muted">{r.email}</div></td>
                  <td>{money(r.total, r.currency)}</td>
                  <td><span className={`badge ${r.consent ? "ok" : ""}`}>{r.consent ? "Yes" : "No"}</span></td>
                  <td>{r.reminderSentAt ? <span className="muted">Sent {new Date(r.reminderSentAt).toLocaleDateString()}</span> : <button disabled={!r.consent || !r.email || busy === r.id} title={r.consent ? "" : "This customer didn't ask for reminders"} onClick={() => send(r.id)}>{busy === r.id ? "Sending…" : "Send reminder"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && !rows.length && <p className="muted">No abandoned checkouts in the last 14 days.</p>}
      </div>
    </>
  );
}
