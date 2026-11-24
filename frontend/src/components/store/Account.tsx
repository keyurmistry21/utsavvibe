"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/api";

type Me = { email: string; name: string; phone: string; acceptsEmail: boolean };
type Ord = { number: number; createdAt: string; currency: string; total: number; status: string; paymentStatus: string; market: string; trackingNumber: string | null; trackingUrl: string | null; carrier: string | null; items: { title: string; quantity: number }[] };

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/store/account${path}`, { method: init?.method ?? "GET", headers: { "content-type": "application/json" }, body: init?.body ? JSON.stringify(init.body) : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error === "validation" ? "Check the email and the 6-digit code" : d.error ?? "Something went wrong"), { status: res.status });
  return d as T;
}
const label = (o: Ord) => (o.status === "cancelled" ? "Cancelled" : o.paymentStatus === "refunded" ? "Refunded" : o.paymentStatus !== "paid" ? "Waiting for payment" : o.status === "fulfilled" ? "Shipped / collected" : "Being prepared");

export function Account({ market }: { market: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [orders, setOrders] = useState<Ord[]>([]);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { const m = await call<Me>("/me"); setMe(m); setOrders(await call<Ord[]>("/orders")); } catch { setMe(null); }
  };
  useEffect(() => { load(); }, []);

  const request = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await call("/request-code", { method: "POST", body: { email } }); setSent(true); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await call("/verify", { method: "POST", body: { email, code } }); setCode(""); setSent(false); await load(); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!me) return; setMsg(""); setErr("");
    try { await call("/me", { method: "PUT", body: { name: me.name, phone: me.phone, acceptsEmail: me.acceptsEmail } }); setMsg("Saved."); } catch (x) { setErr((x as Error).message); }
  };
  const logout = async () => { await call("/logout", { method: "POST" }).catch(() => {}); setMe(null); setOrders([]); };

  if (me === undefined) return <p className="muted">Loading…</p>;
  if (!me) {
    return (
      <form onSubmit={sent ? verify : request} className="trackform">
        <p className="muted">{sent ? `We emailed a 6-digit code to ${email}. It works for 10 minutes.` : "Enter your email and we'll send you a sign-in code. No password needed."}</p>
        {!sent && <div className="field"><label htmlFor="ac-email">Email</label><input id="ac-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></div>}
        {sent && <div className="field"><label htmlFor="ac-code">Sign-in code</label><input id="ac-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus /></div>}
        {err && <div className="error" role="alert">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? "Please wait…" : sent ? "Sign in" : "Email me a code"}</button>
        {sent && <button type="button" className="linklike" onClick={() => { setSent(false); setCode(""); setErr(""); }}>Use a different email</button>}
      </form>
    );
  }
  return (
    <>
      <p>Signed in as <b>{me.email}</b> · <button className="linklike" onClick={logout}>Sign out</button></p>
      <h2>Your orders</h2>
      {orders.length ? orders.map((o) => (
        <div key={o.number} className="card trackcard">
          <b>Order #{o.number}</b> · {new Date(o.createdAt).toLocaleDateString()} · {money(o.total, o.currency)}
          <p className="trackstatus">{label(o)}</p>
          <ul className="trackitems">{o.items.map((i, k) => <li key={k}>{i.quantity} × {i.title}</li>)}</ul>
          {o.trackingNumber && <p>Tracking: {o.trackingUrl ? <a href={o.trackingUrl} target="_blank" rel="noreferrer noopener">{o.trackingNumber}</a> : o.trackingNumber}</p>}
        </div>
      )) : <p className="muted">No orders yet. <a href={`/${market}`}>Start shopping</a></p>}
      <h2>Your details</h2>
      <form onSubmit={save} className="trackform">
        <div className="field"><label htmlFor="ac-name">Name</label><input id="ac-name" value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} autoComplete="name" /></div>
        <div className="field"><label htmlFor="ac-phone">Phone</label><input id="ac-phone" value={me.phone} onChange={(e) => setMe({ ...me, phone: e.target.value })} autoComplete="tel" /></div>
        <label className="consent"><input type="checkbox" checked={me.acceptsEmail} onChange={(e) => setMe({ ...me, acceptsEmail: e.target.checked })} /> Email me offers and news. Unsubscribe any time.</label>
        {err && <div className="error" role="alert">{err}</div>}
        {msg && <p className="giftok" role="status">{msg}</p>}
        <button className="primary">Save</button>
      </form>
    </>
  );
}
