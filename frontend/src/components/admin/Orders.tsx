"use client";

import Link from "next/link";
import { useState } from "react";
import { money, type Order } from "@/lib/api";
import { Badge, TagList, useApi } from "./hooks";

const tabs = [
  ["", "All"],
  ["open", "Open"],
  ["fulfilled", "Fulfilled"],
  ["cancelled", "Cancelled"],
  ["draft", "Drafts"],
] as const;

export function Orders() {
  const [tab, setTab] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(location.search).get("status") ?? ""));
  const { data, error } = useApi<Order[]>(`/orders${tab ? `?status=${tab}` : ""}`);

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
      {error && <div className="error">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Market</th><th>Total</th><th>Payment</th><th>Status</th><th>Tags</th></tr></thead>
          <tbody>
            {data?.map((o) => (
              <tr key={o.id}>
                <td><Link className="lnk" href={`/admin/orders/${o.id}`}>#{o.number}</Link></td>
                <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                <td>{o.customer?.name || o.customer?.email}</td>
                <td>{o.market.code}</td>
                <td>{money(o.total, o.currency)}</td>
                <td><Badge value={o.paymentStatus} /></td>
                <td><Badge value={o.status} /></td>
                <td><TagList tags={o.tags} /></td>
              </tr>
            ))}
            {data && !data.length && <tr><td colSpan={8} className="muted">{tab === "draft" ? "No draft orders. Create an order to start one." : "No orders yet."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
