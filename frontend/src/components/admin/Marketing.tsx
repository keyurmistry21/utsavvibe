"use client";

import { useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import { Switch } from "./Switch";
import { CopyBox } from "./CopyBox";
import { useApi } from "./hooks";
import { Banner } from "./Banner";

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

      <Banner title="Marketing summary" ring={{ value: info?.stats.sent30d ?? "–", label: "reminders sent", segs: [{ cls: "ok", n: info?.stats.recovered30d ?? 0 }, { cls: "low", n: Math.max(0, (info?.stats.sent30d ?? 0) - (info?.stats.recovered30d ?? 0)) }] }} stats={[
        { label: "Carts won back (30 days)", value: info?.stats.recovered30d ?? "–", tone: "ok" },
        { label: "Customers who opted in", value: info?.stats.optedIn ?? "–", tone: "low" },
        { label: "Abandoned checkouts (14 days)", value: rows?.length ?? "–", tone: "out" },
        { label: "Reminder emails", value: info ? (info.abandoned.abandonedEnabled ? "On" : "Off") : "–", tone: info?.abandoned.abandonedEnabled ? "ok" : "arch" },
      ]} />

      <div className="card" style={{ borderRadius: 18 }}>
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

      <div className="card" style={{ borderRadius: 18 }}>
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

      <div className="mk-sec"><h3>Recent abandoned checkouts</h3><span className="muted">Shoppers who started paying and left, last 14 days</span></div>
      <div className="xr-list">
        {rows?.map((r) => (
          <div key={r.id} className={`xr ${r.reminderSentAt ? "ok" : r.consent ? "low" : "arch"}`} style={{ ["--cols" as string]: "70px minmax(0,1.4fr) 110px 150px auto" }}>
            <span className="xr-main"><b>#{r.number}</b><small>{new Date(r.createdAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></span>
            <span className="xr-main"><b>{r.name || r.email || "No name"}</b><small>{r.name ? r.email : ""}</small></span>
            <span className="xr-num">{money(r.total, r.currency)}</span>
            <span className="xr-chips hide-s"><span className={`badge ${r.consent ? "ok" : ""}`}>{r.consent ? "Wants reminders" : "No reminders"}</span></span>
            <span className="xr-act">{r.reminderSentAt ? <span className="muted">Sent {new Date(r.reminderSentAt).toLocaleDateString()}</span> : <button disabled={!r.consent || !r.email || busy === r.id} title={r.consent ? "" : "This customer did not tick the reminder box"} onClick={() => send(r.id)}>{busy === r.id ? "Sending…" : "Send reminder"}</button>}</span>
          </div>
        ))}
        {rows && !rows.length && <div className="xr-empty"><div aria-hidden>🛒</div><b>No abandoned checkouts</b><span>Nothing in the last 14 days.</span></div>}
      </div>
    </>
  );
}
