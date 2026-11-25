"use client";

import Link from "next/link";
import { useState } from "react";
import { money, type Order } from "@/lib/api";
import { Badge, TagList, useApi } from "./hooks";
import { useAdminMarket } from "@/lib/adminMarket";
import { Select } from "../Select";
import { DateRangePicker } from "./DateRangePicker";
import { today, ymd } from "@/lib/dates";

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
  const [range, setRange] = useState<"today" | "7d" | "30d" | "90d" | "year" | "custom">("30d");
  const [custom, setCustom] = useState({ from: ymd(new Date(Date.now() - 29 * 864e5)), to: today() });
  // the chosen period as days: it narrows the numbers in the banner and the list below
  const period = (() => {
    if (range === "custom") return { from: custom.from, to: custom.to };
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (range === "7d") d.setDate(d.getDate() - 6); else if (range === "30d") d.setDate(d.getDate() - 29); else if (range === "90d") d.setDate(d.getDate() - 89); else if (range === "year") d.setMonth(0, 1);
    return { from: ymd(d), to: today() };
  })();
  const { data: stats } = useApi<{ orders: number; items: number; fulfilled: number; toFulfil: number; money: { currency: string; sales: number; refunds: number }[] }>(`/orders/stats/summary?${new URLSearchParams({ from: period.from, to: period.to, ...(market ? { market } : {}), ...(channel ? { channel } : {}), ...(locId ? { location: locId } : {}) })}`);
  const filters = new URLSearchParams({ from: period.from, to: period.to, ...(tab ? { status: tab } : {}), ...(market ? { market } : {}), ...(channel ? { channel } : {}), ...(locId ? { location: locId } : {}) });
  const { data, error } = useApi<Order[]>(`/orders?${new URLSearchParams({ from: period.from, to: period.to, ...(tab ? { status: tab } : {}), ...(market ? { market } : {}), ...(channel ? { channel } : {}), ...(locId ? { location: locId } : {}) })}`);

  const CIRC = 2 * Math.PI * 48;
  const done = stats?.fulfilled ?? 0, todo = stats?.toFulfil ?? 0, rest = Math.max(0, (stats?.orders ?? 0) - done - todo);
  let off = 0;
  const ringSegs = ([["ok", done], ["low", todo], ["arch", rest]] as const).filter(([, n]) => n > 0).map(([cls, n]) => { const len = (n / Math.max(1, stats?.orders ?? 1)) * CIRC; const g = { cls, len: Math.max(0, len - 3), off }; off += len; return g; });
  const stripe = (o: Order) => (o.status === "cancelled" ? "out" : o.paymentStatus === "paid" && o.status === "fulfilled" ? "ok" : o.paymentStatus === "paid" ? "low" : o.status === "draft" ? "arch" : "low");

  return (
    <>
      <div className="pagehead">
        <h2>Orders</h2>
        <span className="headtools"><a className="btn-link" href={`/api/admin/orders/export.csv?${filters}`} download>Export CSV</a><Link href="/admin/orders/new" className="btn-link primary">Create order</Link></span>
      </div>

      <div className="iv">
        <section className="iv-hero od-hero" aria-label="Sales summary">
          <div className="od-range" role="group" aria-label="Period">
            {([["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["year", "This year"], ["custom", "Custom"]] as const).map(([k, l]) => <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{l}</button>)}
          </div>
          {range === "custom" && <div className="od-custom"><DateRangePicker from={custom.from} to={custom.to} onChange={(from, to) => setCustom({ from, to })} /></div>}
          <div className="iv-ring" role="img" aria-label={`${stats?.orders ?? 0} orders: ${done} fulfilled, ${todo} to fulfil`}>
            <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" className="iv-ring-bg" />{ringSegs.map((g) => <circle key={g.cls} cx="60" cy="60" r="48" className={`iv-ring-seg ${g.cls}`} strokeDasharray={`${g.len} ${CIRC - g.len}`} strokeDashoffset={-g.off} />)}</svg>
            <div className="iv-ring-mid"><b>{stats?.orders ?? "–"}</b><span>orders</span></div>
          </div>
          <div className="iv-stats od-stats">
            <div className="iv-stat ok"><i /><b className="od-money">{stats ? (stats.money.length ? stats.money.map((m) => <span key={m.currency}>{money(m.sales, m.currency)}</span>) : "0") : "–"}</b><span>Sales</span></div>
            <button className={`iv-stat low ${tab === "open" ? "on" : ""}`} onClick={() => setTab(tab === "open" ? "" : "open")}><i /><b>{stats?.toFulfil ?? "–"}</b><span>Paid, to fulfil</span></button>
            <button className={`iv-stat ok ${tab === "fulfilled" ? "on" : ""}`} onClick={() => setTab(tab === "fulfilled" ? "" : "fulfilled")}><i /><b>{stats?.fulfilled ?? "–"}</b><span>Fulfilled</span></button>
            <div className="iv-stat arch"><i /><b>{stats?.items ?? "–"}</b><span>Items ordered</span></div>
            <div className="iv-stat out"><i /><b className="od-money">{stats ? (stats.money.some((m) => m.refunds) ? stats.money.filter((m) => m.refunds).map((m) => <span key={m.currency}>{money(m.refunds, m.currency)}</span>) : "0") : "–"}</b><span>Sales reversals</span></div>
          </div>
        </section>
      </div>

      <div className="pl-tools">
        <div className="inv-chips" role="group" aria-label="Status">{tabs.map(([key, label]) => <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
        <div className="inv-chips" role="group" aria-label="Channel">{([["", "All channels"], ["online", "Online"], ["in_store", "In-store"]] as const).map(([k, l]) => <button key={k} className={channel === k ? "on" : ""} onClick={() => setChannel(k)}>{l}</button>)}</div>
        {!!locations && locations.length > 0 && <Select value={locId} onChange={(e) => setLocId(e.target.value)} aria-label="Location"><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
      </div>
      {error && <div className="error">{error}</div>}

      <div className="pl-list">
        {data?.map((o) => (
          <Link key={o.id} href={`/admin/orders/${o.id}`} className={`od-row ${stripe(o)}`}>
            <span className="od-num"><b>#{o.number}</b><small>{new Date(o.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small></span>
            <span className="od-who">
              <b>{o.customer?.name || o.customer?.email || "No customer"}{(o.riskLevel === "high" || o.riskLevel === "medium") && <span className={`badge ${o.riskLevel === "high" ? "bad" : "warn"}`} style={{ marginLeft: 8 }} title={o.riskNote ?? ""}>{o.riskLevel === "high" ? "High risk" : "Review"}</span>}</b>
              <small>{[o.customer?.name ? o.customer.email : "", o.channel === "in_store" ? `In-store${o.salespersonName ? " · " + o.salespersonName : ""}` : "Online"].filter(Boolean).join(" · ")}</small>
            </span>
            <span className="od-where"><span className="chip">{o.market.code}</span>{o.locationName && <span className="chip">{o.locationName}</span>}<TagList tags={o.tags} /></span>
            <span className="od-state"><Badge value={o.paymentStatus} /><Badge value={o.status} /></span>
            <span className="od-total">{money(o.total, o.currency)}</span>
            <svg className="iv-go" viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
          </Link>
        ))}
        {data && !data.length && <div className="iv-empty"><div aria-hidden>🧾</div><b>{tab === "draft" ? "No draft orders" : "No orders yet"}</b><span>{tab === "draft" ? "Create an order to start one." : "Orders appear here as soon as someone buys."}</span></div>}
        {!data && !error && <div className="iv-empty"><span>Loading…</span></div>}
      </div>
    </>
  );
}
