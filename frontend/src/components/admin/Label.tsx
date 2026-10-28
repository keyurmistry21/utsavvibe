"use client";

import { useEffect, useState } from "react";
import { api, type Order } from "@/lib/api";
import { money } from "@/lib/api";

type Addr = { name: string; company: string; line1: string; line2: string; city: string; region: string; postcode: string; country: string; phone: string };

export function Label({ id }: { id: string }) {
  const [o, setO] = useState<Order | null>(null);
  const [from, setFrom] = useState<Addr | null>(null);
  const [slip, setSlip] = useState(false);
  useEffect(() => {
    setSlip(new URLSearchParams(location.search).get("type") === "slip");
    api<Order>(`/orders/${id}`).then(setO);
    api<Addr>("/settings/ship-from").then(setFrom);
  }, [id]);
  if (!o || !from) return <p>Loading…</p>;
  const a = o.shippingAddress as Record<string, string>;
  const region = o.market.regions?.find((r) => r.code === a.region)?.name ?? a.region;
  const units = o.items.reduce((s, i) => s + i.quantity, 0);
  const noFrom = !from.line1;

  return (
    <>
      <div className="noprint pagehead">
        <h2>{slip ? "Packing slip" : "Shipping label"} · #{o.number}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn-link" href={`/admin/orders/${id}`}>Back</a>
          <button className="primary" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      {noFrom && <div className="error noprint">No ship-from address yet. Add it under <a href="/admin/settings">Settings</a>.</div>}
      {!slip ? (
        <div className="label4x6">
          <div className="lfrom">
            <small>FROM</small>
            <div>{from.company || from.name}</div>
            <div>{from.line1}{from.line2 ? `, ${from.line2}` : ""}</div>
            <div>{from.city} {from.region} {from.postcode} {from.country}</div>
          </div>
          <div className="lto">
            <small>SHIP TO</small>
            <div className="big">{o.shippingName}</div>
            <div className="big">{a.line1}{a.line2 ? `, ${a.line2}` : ""}</div>
            <div className="big">{a.city}{region ? `, ${region}` : ""} {a.postcode}</div>
            <div className="big">{a.country}</div>
            {o.customer?.phone && <div>Tel: {o.customer.phone}</div>}
          </div>
          <div className="lmeta">
            <div><small>ORDER</small><b>#{o.number}</b></div>
            <div><small>WEIGHT</small><b>{o.packageWeightG ? `${o.packageWeightG} g` : "—"}</b></div>
            <div><small>ITEMS</small><b>{units}</b></div>
          </div>
          <div className="ltrack">
            <small>{o.carrier ?? "CARRIER"} TRACKING</small>
            <b>{o.trackingNumber ?? "— not assigned —"}</b>
          </div>
        </div>
      ) : (
        <div className="slip">
          <h1>Packing slip</h1>
          <div className="slip-top">
            <div><b>{from.company || from.name || "UtsavVibe"}</b><div>{from.line1}</div><div>{from.city} {from.postcode} {from.country}</div></div>
            <div><b>Order #{o.number}</b><div>{new Date(o.createdAt).toLocaleDateString()}</div></div>
          </div>
          <div className="slip-to"><small>SHIP TO</small><div>{o.shippingName}</div><div>{a.line1}{a.line2 ? `, ${a.line2}` : ""}</div><div>{a.city}{region ? `, ${region}` : ""} {a.postcode}</div><div>{a.country}</div></div>
          <table><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>{o.items.map((i) => <tr key={i.id}><td>{i.title}</td><td>{i.quantity}</td></tr>)}</tbody></table>
          <p className="muted">Total paid: {money(o.total, o.currency)}. Thank you for shopping with us!</p>
        </div>
      )}
    </>
  );
}
