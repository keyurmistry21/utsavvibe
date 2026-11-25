"use client";

import Link from "next/link";
import { useState } from "react";
import { money, type Order } from "@/lib/api";
import { Badge, TagList, useApi } from "./hooks";
import { useAdminMarket } from "@/lib/adminMarket";
import { Select } from "../Select";

const tabs = [
  ["", "All"],
  ["open", "Open"],
  ["fulfilled", "Fulfilled"],
  ["cancelled", "Cancelled"],
  ["draft", "Drafts"],
] as const;

export function Orders() {
  const [tab, setTab] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(location.search).get("status") ?? ""));
  const { market } = useAdminMarket();
  const [channel, setChannel] = useState<"" | "online" | "in_store">("");
  const [locId, setLocId] = useState("");
  const { data: locations } = useApi<{ id: string; name: string }[]>("/orders/locations");
  const [range, setRange] = useState<"today" | "7d" | "30d" | "year">("today");
  const { data: stats } = useApi<{ orders: number; items: number; fulfilled: number; toFulfil: number; money: { currency: string; sales: number; refunds: number }[] }>(`/orders/stats/summary?${new URLSearchParams({ range, ...(market ? { market } : {}), ...(channel ? { channel } : {}), ...(locId ? { location: locId } : {}) })}`);
  const filters = new URLSearchParams({ ...(tab ? { status: tab } : {}), ...(market ? { market } : {}), ...(channel ? { channel } : {}), ...(locId ? { location: locId } : {}) });
  const { data, error } = useApi<Order[]>(`/orders?${new URLSearchParams({ ...(tab ? { status: tab } : {}), ...(market ? { market } : {}), ...(channel ? { channel } : {}), ...(locId ? { location: locId } : {}) })}`);

  return (
    <>
      <div className="pagehead">
        <h2>Orders</h2>
        <span className="headtools"><a className="btn-link" href={`/api/admin/orders/export.csv?${filters}`} download>Export CSV</a><Link href="/admin/orders/new" className="btn-link primary">Create order</Link></span>
      </div>
      <div className="card ostats">
        <div className="ostats-range">
          {([["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["year", "This year"]] as const).map(([k, l]) => <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{l}</button>)}
        </div>
        <div className="ostats-grid">
          <div><span>Orders</span><b>{stats?.orders ?? "–"}</b></div>
          <div><span>Items ordered</span><b>{stats?.items ?? "–"}</b></div>
          <div><span>Sales</span><b>{stats ? (stats.money.length ? stats.money.map((m) => <span key={m.currency} style={{ display: "block", font: "inherit", color: "inherit" }}>{money(m.sales, m.currency)}</span>) : "0") : "–"}</b></div>
          <div><span>Sales reversals</span><b>{stats ? (stats.money.some((m) => m.refunds) ? stats.money.filter((m) => m.refunds).map((m) => <span key={m.currency} style={{ display: "block", font: "inherit", color: "inherit" }}>{money(m.refunds, m.currency)}</span>) : "0") : "–"}</b></div>
          <div><span>Orders fulfilled</span><b>{stats?.fulfilled ?? "–"}</b></div>
          <div><span>Paid, to fulfil</span><b>{stats?.toFulfil ?? "–"}</b></div>
        </div>
      </div>
      <div className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      <div className="tabs" role="group" aria-label="Channel" style={{ marginLeft: 8 }}>
        {([["", "All channels"], ["online", "Online"], ["in_store", "In-store"]] as const).map(([k, l]) => <button key={k} className={channel === k ? "on" : ""} onClick={() => setChannel(k)}>{l}</button>)}
      </div>
      {!!locations && locations.length > 0 && (
        <div className="tabs" role="group" aria-label="Location" style={{ marginLeft: 8, alignItems: "center", gap: 8 }}>
          <span className="muted">Location</span>
          <Select value={locId} onChange={(e) => setLocId(e.target.value)}><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Channel</th><th>Market</th><th>Location</th><th>Total</th><th>Payment</th><th>Status</th><th>Tags</th></tr></thead>
          <tbody>
            {data?.map((o) => (
              <tr key={o.id}>
                <td><Link className="lnk" href={`/admin/orders/${o.id}`}>#{o.number}</Link></td>
                <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                <td>{o.customer?.name || o.customer?.email}{(o.riskLevel === "high" || o.riskLevel === "medium") && <span className={`badge ${o.riskLevel === "high" ? "bad" : "warn"}`} style={{ marginLeft: 6 }} title={o.riskNote ?? ""}>{o.riskLevel === "high" ? "High risk" : "Review"}</span>}</td>
                <td>{o.channel === "in_store" ? <span title={o.locationName ?? ""}>In-store<div className="muted">{o.salespersonName}</div></span> : "Online"}</td>
                <td>{o.market.code}</td><td>{o.locationName || "–"}</td>
                <td>{money(o.total, o.currency)}</td>
                <td><Badge value={o.paymentStatus} /></td>
                <td><Badge value={o.status} /></td>
                <td><TagList tags={o.tags} /></td>
              </tr>
            ))}
            {data && !data.length && <tr><td colSpan={10} className="muted">{tab === "draft" ? "No draft orders. Create an order to start one." : "No orders yet."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
