"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "./hooks";
import { Modal } from "./Modal";

type Log = { id: string; kind: string; toEmail: string; subject: string; status: string; error: string | null; createdAt: string };
const LABEL: Record<string, string> = { order_confirmation: "Order confirmation", payment_link: "Payment link", test: "Test email" };

// Email history for an order, plus preview and (for paid orders) resend.
export function OrderEmails({ orderId, paid, hasEmail, tick, onChanged }: { orderId: string; paid: boolean; hasEmail: boolean; tick: number; onChanged: () => void }) {
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<Log[]>(`/orders/${orderId}/emails`).then(setLogs).catch(() => setLogs([]));
  useEffect(() => { load(); }, [orderId, tick]);

  const resend = async () => {
    setBusy(true); setMsg(null);
    try { await api(`/orders/${orderId}/resend-confirmation`, { method: "POST" }); setMsg({ ok: true, text: "Confirmation email sent." }); await load(); onChanged(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };
  const open = async (kind: "order_confirmation" | "payment_link") => {
    try { setPreview(await api(`/orders/${orderId}/email-preview?kind=${kind}`)); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  return (
    <div className="card">
      <div className="cardhead">
        <h3>Customer emails</h3>
        <div className="cardactions">
          <button onClick={() => open(paid ? "order_confirmation" : "payment_link")}>Preview</button>
          {paid && <button disabled={!hasEmail || busy} title={hasEmail ? "" : "This order has no customer email"} onClick={resend}>{busy ? "Sending…" : "Resend confirmation"}</button>}
        </div>
      </div>
      {msg && <div className={msg.ok ? "okmsg" : "error"}>{msg.text}</div>}
      {!hasEmail && <p className="muted">No customer email on this order, so nothing is sent automatically.</p>}
      {logs && !logs.length && hasEmail && <p className="muted">{paid ? "No emails sent yet." : "Nothing sent yet. The payment link email goes out when you click “Email to customer”."}</p>}
      {!!logs?.length && (
        <ul className="maillog">
          {logs.map((l) => (
            <li key={l.id}>
              <div><b>{LABEL[l.kind] ?? l.kind}</b> <span className="muted">to {l.toEmail}</span>{l.error && <div className="muted" title={l.error}>{l.error.slice(0, 90)}</div>}</div>
              <div className="maillog-r"><Badge value={l.status} /> <span className="muted">{new Date(l.createdAt).toLocaleString()}</span></div>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <Modal title={preview.subject} onClose={() => setPreview(null)}>
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="mailframe" />
        </Modal>
      )}
    </div>
  );
}
