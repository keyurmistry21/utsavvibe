"use client";

import { useState } from "react";
import { money } from "@/lib/api";
import { useApi } from "./hooks";
import { Select } from "../Select";

type Summary = {
  markets: { code: string; currency: string; orders: number; revenue: number; tax: number; shipping: number }[];
  topProducts: { title: string; quantity: number }[];
  customers: number; pendingOrders: number;
};

export function Dashboard() {
  const [days, setDays] = useState(30);
  const { data, error } = useApi<Summary>(`/analytics/summary?days=${days}`);
  if (error) return <div className="error">{error}</div>;
  if (!data) return <p>Loading…</p>;
  return (
    <>
      <div className="pagehead">
        <h2>Analytics</h2>
        <Select style={{ width: 160 }} value={days} onChange={(e) => setDays(+e.target.value)}>
          {[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </Select>
      </div>
      <div className="stats">
        <div className="card stat">Customers<b>{data.customers}</b></div>
        <div className="card stat">Orders to fulfil<b>{data.pendingOrders}</b></div>
      </div>
      <div className="card">
        <h3>Sales by market</h3>
        <p className="muted">Each market is shown in its own currency; no cross-currency totals.</p>
        <table>
          <thead><tr><th>Market</th><th>Orders</th><th>Revenue</th><th>Tax</th><th>Shipping</th></tr></thead>
          <tbody>
            {data.markets.map((m) => (
              <tr key={m.code}>
                <td>{m.code}</td><td>{m.orders}</td>
                <td>{money(m.revenue, m.currency)}</td><td>{money(m.tax, m.currency)}</td><td>{money(m.shipping, m.currency)}</td>
              </tr>
            ))}
            {!data.markets.length && <tr><td colSpan={5} className="muted">No paid orders in range.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Top products</h3>
        <table>
          <tbody>{data.topProducts.map((p) => <tr key={p.title}><td>{p.title}</td><td>{p.quantity} sold</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
