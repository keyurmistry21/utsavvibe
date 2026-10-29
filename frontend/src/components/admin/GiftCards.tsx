"use client";

import { useState } from "react";
import { api, money, toMinor, type Market } from "@/lib/api";
import { email as emailErr, money as moneyErr, maxLen } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { Modal } from "./Modal";
import { useCan } from "@/lib/perms";
import { useApi } from "./hooks";
import { Select } from "../Select";

type Card = { id: string; code: string; currency: string; initialAmount: number; balance: number; active: boolean; expiresAt: string | null; recipientEmail: string | null; note: string; createdAt: string; orderId: string | null };
type Detail = Card & { txs: { id: string; amount: number; kind: string; note: string; createdAt: string; orderNumber: number | null }[] };
const KIND: Record<string, string> = { issue: "Issued", redeem: "Spent on order", release: "Returned (order not completed)", adjust: "Adjusted by staff" };
const when = (iso: string) => new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
const stateOf = (c: Card) => (!c.active ? "Disabled" : c.expiresAt && new Date(c.expiresAt) < new Date() ? "Expired" : c.balance <= 0 ? "Used" : "Active");

function Issue({ currencies, onClose, onDone }: { currencies: string[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: "", currency: currencies[0] ?? "GBP", recipientEmail: "", note: "", expires: "", send: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ code: string; emailed: string | null; emailError: string | null } | null>(null);
  const val = useValidation({
    amount: moneyErr(f.amount, { required: true, label: "amount", max: 10_000 }) || (Number(f.amount) < 1 ? "The minimum is 1.00" : ""),
    recipientEmail: emailErr(f.recipientEmail) || (f.send && !f.recipientEmail.trim() ? "Enter an email to send the card to" : ""),
    note: maxLen(f.note, 500, "The note"),
    expires: f.expires && new Date(f.expires) < new Date(new Date().toDateString()) ? "Pick a date in the future" : "",
  });
  const issue = async () => {
    if (!val.submit()) return;
    setErr(""); setBusy(true);
    try {
      const r = await api<{ code: string; emailed: string | null; emailError: string | null }>("/gift-cards", { method: "POST", json: { amount: toMinor(f.amount), currency: f.currency, recipientEmail: f.recipientEmail.trim(), note: f.note, send: f.send, expiresAt: f.expires ? new Date(`${f.expires}T23:59:59`).toISOString() : null } });
      setMade(r); onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  if (made) return (
    <Modal title="Gift card created" onClose={onClose} footer={<button className="primary" onClick={onClose}>Done</button>}>
      <p>Give this code to the customer. It can be spent at checkout.</p>
      <p style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 22, letterSpacing: ".06em", fontWeight: 700 }}>{made.code} <button onClick={() => navigator.clipboard.writeText(made.code)}>Copy</button></p>
      {made.emailed === "sent" && <p className="okmsg">Emailed to {f.recipientEmail}.</p>}
      {made.emailed && made.emailed !== "sent" && <div className="error">The card was created but the email was not sent: {made.emailError}</div>}
    </Modal>
  );
  return (
    <Modal title="Issue gift card" onClose={onClose} footer={<><span /><span style={{ display: "flex", gap: 8 }}><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={issue}>{busy ? "Creating…" : "Create gift card"}</button></span></>}>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <div className="field"><label htmlFor="gc-amt">Amount</label><input id="gc-amt" inputMode="decimal" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} {...val.props("amount")} /><FieldError k="amount" msg={val.err("amount")} /></div>
        <div className="field"><label>Currency</label><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{currencies.map((c) => <option key={c}>{c}</option>)}</Select><div className="muted">Only works in markets using this currency.</div></div>
      </div>
      <div className="field"><label htmlFor="gc-mail">Recipient email (optional)</label><input id="gc-mail" type="email" value={f.recipientEmail} onChange={(e) => setF({ ...f, recipientEmail: e.target.value })} {...val.props("recipientEmail")} /><FieldError k="recipientEmail" msg={val.err("recipientEmail")} /></div>
      <label className="check"><input type="checkbox" checked={f.send} onChange={(e) => setF({ ...f, send: e.target.checked })} />Email the code to the recipient now</label>
      <div className="field"><label htmlFor="gc-exp">Expires on (optional)</label><input id="gc-exp" type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} {...val.props("expires")} /><FieldError k="expires" msg={val.err("expires")} /></div>
      <div className="field" style={{ marginBottom: 0 }}><label htmlFor="gc-note">Internal note (optional)</label><input id="gc-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Goodwill for late order #1042" {...val.props("note")} /><FieldError k="note" msg={val.err("note")} /></div>
    </Modal>
  );
}

function Detail({ id, canManage, onClose, onChanged }: { id: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { data: c, reload } = useApi<Detail>(`/gift-cards/${id}`);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [adj, setAdj] = useState({ amount: "", note: "", sign: "-1" });
  const [to, setTo] = useState("");
  const run = async (fn: () => Promise<unknown>, ok = "") => { setErr(""); setMsg(""); try { await fn(); if (ok) setMsg(ok); reload(); onChanged(); } catch (e) { setErr((e as Error).message); } };
  if (!c) return <Modal title="Gift card" onClose={onClose}>{err ? <div className="error">{err}</div> : <p>Loading…</p>}</Modal>;
  return (
    <Modal title="Gift card" onClose={onClose} wide>
      {err && <div className="error">{err}</div>}{msg && <div className="okmsg">{msg}</div>}
      <p style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 20, fontWeight: 700, letterSpacing: ".06em" }}>{c.code} <button onClick={() => navigator.clipboard.writeText(c.code).then(() => setMsg("Code copied"))}>Copy</button></p>
      <p><b>{money(c.balance, c.currency)}</b> left of {money(c.initialAmount, c.currency)} · <span className={`badge ${stateOf(c) === "Active" ? "ok" : ""}`}>{stateOf(c)}</span>{c.expiresAt && <span className="muted"> · expires {new Date(c.expiresAt).toLocaleDateString("en", { dateStyle: "medium" })}</span>}</p>
      {c.recipientEmail && <p className="muted">Sent to {c.recipientEmail}</p>}
      {c.note && <p className="muted">Note: {c.note}</p>}
      <h4>History</h4>
      <table><tbody>
        {c.txs.map((t) => <tr key={t.id}><td>{when(t.createdAt)}</td><td>{KIND[t.kind] ?? t.kind}{t.orderNumber ? ` #${t.orderNumber}` : ""}{t.note ? ` · ${t.note}` : ""}</td><td style={{ textAlign: "right", color: t.amount < 0 ? "inherit" : "#1a7f4b" }}>{t.amount < 0 ? "−" : "+"}{money(Math.abs(t.amount), c.currency)}</td></tr>)}
      </tbody></table>
      {canManage && (
        <>
          <h4>Adjust balance</h4>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ maxWidth: 110 }}><label>Change</label><Select value={adj.sign} onChange={(e) => setAdj({ ...adj, sign: e.target.value })}><option value="-1">Deduct</option><option value="1">Add</option></Select></div>
            <div className="field" style={{ maxWidth: 130 }}><label htmlFor="adj-a">Amount</label><input id="adj-a" inputMode="decimal" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></div>
            <div className="field grow"><label htmlFor="adj-n">Reason</label><input id="adj-n" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></div>
            <div className="field" style={{ flex: "none", minWidth: 0 }}><button disabled={!adj.amount || !adj.note.trim()} onClick={() => { const n = toMinor(adj.amount); if (!(n > 0)) return setErr("Enter an amount greater than zero"); run(() => api(`/gift-cards/${id}/adjust`, { method: "POST", json: { amount: n * Number(adj.sign), note: adj.note } }), "Balance updated").then(() => setAdj({ amount: "", note: "", sign: "-1" })); }}>Apply</button></div>
          </div>
          <h4>Send the code by email</h4>
          <div style={{ display: "flex", gap: 8 }}><input aria-label="Email address" type="email" placeholder="name@example.com" value={to} onChange={(e) => setTo(e.target.value)} /><button disabled={!to.trim() || !c.active || c.balance <= 0} onClick={() => run(() => api(`/gift-cards/${id}/email`, { method: "POST", json: { to: to.trim() } }), `Emailed to ${to.trim()}`)}>Send</button></div>
          <h4>Status</h4>
          <button className={c.active ? "danger" : ""} onClick={() => (c.active ? confirm("Disable this gift card? It can't be spent until you enable it again.") : true) && run(() => api(`/gift-cards/${id}`, { method: "PATCH", json: { active: !c.active } }), c.active ? "Gift card disabled" : "Gift card enabled")}>{c.active ? "Disable gift card" : "Enable gift card"}</button>
        </>
      )}
    </Modal>
  );
}

export function GiftCards() {
  const { can } = useCan();
  const manage = can("gift_cards.manage");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const { data: rows, error, reload } = useApi<Card[]>(`/gift-cards?status=${status}&q=${encodeURIComponent(q)}`);
  const { data: markets } = useApi<Market[]>("/markets");
  const [issuing, setIssuing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const currencies = [...new Set((markets ?? []).map((m) => m.currency))];
  return (
    <>
      <div className="pagehead"><h2>Gift cards</h2><div className="headtools">{manage && <button className="primary" disabled={!currencies.length} onClick={() => setIssuing(true)}>Issue gift card</button>}</div></div>
      {error && <div className="error">{error}</div>}
      <p className="muted">Customers can also buy gift cards online: create a product and turn on “This product is a gift card”. Each variant is an amount.</p>
      <div className="card">
        <div className="tabs" role="tablist">{[["all", "All"], ["active", "Active"], ["used", "Used"], ["disabled", "Disabled"]].map(([k, l]) => <button key={k} role="tab" aria-selected={status === k} className={status === k ? "active" : ""} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <div className="field"><label htmlFor="gc-q">Search</label><input id="gc-q" value={q} placeholder="Code, email or note" onChange={(e) => setQ(e.target.value)} /></div>
        <div className="tablescroll">
          <table>
            <thead><tr><th>Code</th><th>Status</th><th>Recipient</th><th style={{ textAlign: "right" }}>Balance</th><th style={{ textAlign: "right" }}>Issued</th></tr></thead>
            <tbody>
              {(rows ?? []).map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setOpen(c.id)}>
                  <td><code>{c.code}</code></td>
                  <td><span className={`badge ${stateOf(c) === "Active" ? "ok" : ""}`}>{stateOf(c)}</span></td>
                  <td className="muted">{c.recipientEmail ?? ""}</td>
                  <td style={{ textAlign: "right" }}>{money(c.balance, c.currency)} <span className="muted">of {money(c.initialAmount, c.currency)}</span></td>
                  <td className="muted" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{new Date(c.createdAt).toLocaleDateString("en", { dateStyle: "medium" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && !rows.length && <p className="muted">{q || status !== "all" ? "No gift cards match." : "No gift cards yet."}</p>}
      </div>
      {issuing && <Issue currencies={currencies} onClose={() => setIssuing(false)} onDone={reload} />}
      {open && <Detail id={open} canManage={manage} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}
