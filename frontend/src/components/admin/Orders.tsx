"use client";

import Link from "next/link";
import { useState } from "react";
import { money, type Order } from "@/lib/api";
import { Badge, TagList, useApi } from "./hooks";
import { useAdminMarket } from "@/lib/adminMarket";

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
  const { data, error } = useApi<Order[]>(`/orders?${new URLSearchParams({ ...(tab ? { status: tab } : {}), ...(market ? { market } : {}), ...(channel ? { channel } : {}) })}`);

  return (
    <>
      <div className="pagehead">
        <h2>Orders</h2>
        <Link href="/admin/orders/new" className="btn-link primary">Create order</Link>
      </div>
      <div className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      <div className="tabs" role="group" aria-label="Channel" style={{ marginLeft: 8 }}>
        {([["", "All channels"], ["online", "Online"], ["in_store", "In-store"]] as const).map(([k, l]) => <button key={k} className={channel === k ? "on" : ""} onClick={() => setChannel(k)}>{l}</button>)}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Channel</th><th>Market</th><th>Total</th><th>Payment</th><th>Status</th><th>Tags</th></tr></thead>
          <tbody>
            {data?.map((o) => (
              <tr key={o.id}>
                <td><Link className="lnk" href={`/admin/orders/${o.id}`}>#{o.number}</Link></td>
                <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                <td>{o.customer?.name || o.customer?.email}{(o.riskLevel === "high" || o.riskLevel === "medium") && <span className={`badge ${o.riskLevel === "high" ? "bad" : "warn"}`} style={{ marginLeft: 6 }} title={o.riskNote ?? ""}>{o.riskLevel === "high" ? "High risk" : "Review"}</span>}</td>
                <td>{o.channel === "in_store" ? <span title={o.locationName ?? ""}>In-store<div className="muted">{o.salespersonName}</div></span> : "Online"}</td>
                <td>{o.market.code}</td>
                <td>{money(o.total, o.currency)}</td>
                <td><Badge value={o.paymentStatus} /></td>
                <td><Badge value={o.status} /></td>
                <td><TagList tags={o.tags} /></td>
              </tr>
            ))}
            {data && !data.length && <tr><td colSpan={9} className="muted">{tab === "draft" ? "No draft orders. Create an order to start one." : "No orders yet."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
