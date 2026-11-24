"use client";

import { useMemo, useState } from "react";
import { money } from "@/lib/api";
import { today, ymd } from "@/lib/dates";
import { useAdminMarket } from "@/lib/adminMarket";
import { useApi } from "./hooks";
import { DateRangePicker } from "./DateRangePicker";

type Tot = { currency: string; sales: number; orders: number; aov: number };
type Insights = {
  days: number; from: string; to: string; pending: number;
  totals: Tot[];
  channels: { currency: string; channel: string; sales: number; orders: number }[];
  salespeople: { id: string; name: string; currency: string; sales: number; orders: number }[];
  locations: { name: string; currency: string; sales: number; orders: number }[];
  topSalesperson: { id: string; name: string; currency: string; sales: number }[];
  topLocation: { name: string; currency: string; sales: number }[];
  topVariants: { title: string; currency: string; quantity: number; revenue: number }[];
  daily: { currency: string; points: { date: string; sales: number }[] }[];
  hourly: { currency: string; hours: number[] }[];
  lowStock: { product: string; variant: string; sku: string | null; market: string; quantity: number }[];
};
type Traffic = {
  funnel: { sessions: number; view_item: number; add_to_cart: number; begin_checkout: number; purchase: number };
  conversionRate: number;
  sources: { source: string; medium: string; campaign: string; sessions: number; add_to_cart: number; purchase: number }[];
  topPages: { path: string; title: string; views: number; avgSeconds: number | null; exits: number; exitRate: number }[];
  exitPages: { path: string; title: string; views: number; exits: number; exitRate: number }[];
};

const PRE = [
  { key: "today", label: "Today", days: 0 },
  { key: "7d", label: "Last 7 days", days: 6 },
  { key: "30d", label: "Last 30 days", days: 29 },
] as const;
const ago = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const secs = (s: number | null) => (s == null ? "–" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
const CH: Record<string, string> = { online: "Online store", in_store: "In-store QR" };

function Bars({ data, fmt }: { data: { label: string; v: number }[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.v));
  return (
    <div className="ins-bars" role="img" aria-label="Sales chart">
      {data.map((d, i) => <div key={i} className="ins-bar" title={`${d.label}: ${fmt(d.v)}`}><i style={{ height: `${Math.max(d.v ? 3 : 0, (d.v / max) * 100)}%` }} /><span>{d.label}</span></div>)}
    </div>
  );
}

export function Insights() {
  const { market } = useAdminMarket();
  const [preset, setPreset] = useState<string>("30d");
  const [custom, setCustom] = useState({ from: ago(29), to: today() });
  const range = useMemo(() => {
    if (preset === "custom") return custom.from && custom.to && custom.from <= custom.to ? custom : null;
    return { from: ago(PRE.find((p) => p.key === preset)!.days), to: today() };
  }, [preset, custom]);
  const qs = `from=${range?.from ?? ago(29)}&to=${range?.to ?? today()}${market ? `&market=${market}` : ""}`;
  const { data, error } = useApi<Insights>(`/analytics/insights?${qs}`);
  const { data: tr } = useApi<Traffic>(`/analytics/traffic?${qs}`);
  const [hourlyView, setHourlyView] = useState(false);
  const mf = (cur: string) => (n: number) => money(n, cur);

  return (
    <div className="ep">
      <div className="ep-filter">
        <div className="ep-seg" role="group" aria-label="Date range">
          {PRE.map((p) => <button key={p.key} className={preset === p.key ? "on" : ""} onClick={() => setPreset(p.key)}>{p.label}</button>)}
          <button className={preset === "custom" ? "on" : ""} onClick={() => setPreset("custom")}>Custom</button>
        </div>
        {preset === "custom" && <DateRangePicker from={custom.from} to={custom.to} onChange={(from, to) => setCustom({ from, to })} />}
      </div>
      {preset === "custom" && !range && <div className="error">The start date must be on or before the end date.</div>}
      {error && <div className="error">{error}</div>}
      {!data && !error && <div className="ep-skel" aria-busy="true"><i /><i /><i /></div>}

      {data && (
        <>
          {data.totals.map((t) => {
            const f = mf(t.currency);
            const ch = data.channels.filter((c) => c.currency === t.currency);
            const topS = data.topSalesperson.find((x) => x.currency === t.currency);
            const topL = data.topLocation.find((x) => x.currency === t.currency);
            const daily = data.daily.find((d) => d.currency === t.currency)?.points ?? [];
            const hours = data.hourly.find((d) => d.currency === t.currency)?.hours ?? [];
            const oneDay = data.days <= 1;
            return (
              <section key={t.currency} className="ep-cur">
                <div className="ep-curhead"><h3>{t.currency}</h3></div>
                <div className="ep-kpis ins-kpis">
                  <div className="ep-kpi big"><div className="ep-kpi-label">Total sales<span>net of tax, paid only</span></div><div className="ep-kpi-value">{f(t.sales)}</div></div>
                  <div className="ep-kpi"><div className="ep-kpi-label">Orders<span>paid</span></div><div className="ep-kpi-value">{t.orders}</div><span className="ep-delta flat">{data.pending} pending / unpaid</span></div>
                  <div className="ep-kpi"><div className="ep-kpi-label">Average order value</div><div className="ep-kpi-value">{f(t.aov)}</div></div>
                  <div className="ep-kpi"><div className="ep-kpi-label">Conversion rate<span>visits → purchase</span></div><div className="ep-kpi-value">{tr ? `${tr.conversionRate}%` : "…"}</div></div>
                  <div className="ep-kpi"><div className="ep-kpi-label">Top location</div><div className="ep-kpi-value sm">{topL ? topL.name : "–"}</div>{topL && <span className="ep-delta flat">{f(topL.sales)}</span>}</div>
                  <div className="ep-kpi"><div className="ep-kpi-label">Top salesperson</div><div className="ep-kpi-value sm">{topS ? topS.name : "–"}</div>{topS && <span className="ep-delta flat">{f(topS.sales)}</span>}</div>
                </div>
                <div className="card ep-card">
                  <div className="ep-panel-head"><h4>Sales over time</h4>
                    {!oneDay && <div className="ep-seg"><button className={!hourlyView ? "on" : ""} onClick={() => setHourlyView(false)}>Daily</button><button className={hourlyView ? "on" : ""} onClick={() => setHourlyView(true)}>By hour of day</button></div>}
                  </div>
                  <Bars fmt={f} data={oneDay || hourlyView ? hours.map((v, h) => ({ label: h % 3 === 0 ? `${h}h` : "", v })) : daily.map((p) => ({ label: p.date.slice(5), v: p.sales }))} />
                </div>
                <div className="ep-two even">
                  <div className="ep-panel">
                    <div className="ep-panel-head"><h4>Sales by channel</h4><span>Online vs in-store QR</span></div>
                    <table className="ep-table"><thead><tr><th>Channel</th><th className="r">Orders</th><th className="r">Sales</th></tr></thead>
                      <tbody>{ch.map((c) => <tr key={c.channel}><td>{CH[c.channel] ?? c.channel}</td><td className="r">{c.orders}</td><td className="r strong">{f(c.sales)}</td></tr>)}</tbody></table>
                  </div>
                  <div className="ep-panel">
                    <div className="ep-panel-head"><h4>In-store by salesperson</h4><span>QR payments</span></div>
                    <table className="ep-table"><thead><tr><th>Name</th><th className="r">Orders</th><th className="r">Sales</th></tr></thead>
                      <tbody>{data.salespeople.filter((s) => s.currency === t.currency).map((s) => <tr key={s.id}><td>{s.name}</td><td className="r">{s.orders}</td><td className="r strong">{f(s.sales)}</td></tr>)}
                        {!data.salespeople.some((s) => s.currency === t.currency) && <tr><td colSpan={3} className="ep-none">No in-store sales.</td></tr>}</tbody></table>
                  </div>
                </div>
                <div className="ep-two even">
                  <div className="ep-panel">
                    <div className="ep-panel-head"><h4>In-store by location</h4></div>
                    <table className="ep-table"><thead><tr><th>Location</th><th className="r">Orders</th><th className="r">Sales</th></tr></thead>
                      <tbody>{data.locations.filter((s) => s.currency === t.currency).map((s) => <tr key={s.name}><td>{s.name}</td><td className="r">{s.orders}</td><td className="r strong">{f(s.sales)}</td></tr>)}
                        {!data.locations.some((s) => s.currency === t.currency) && <tr><td colSpan={3} className="ep-none">No in-store sales.</td></tr>}</tbody></table>
                  </div>
                  <div className="ep-panel">
                    <div className="ep-panel-head"><h4>Top products and variants</h4><span>By units sold</span></div>
                    <ol className="ep-top-list">{data.topVariants.filter((v) => v.currency === t.currency).slice(0, 10).map((v, i) => <li key={v.title}><span className="rank">{i + 1}</span><span className="name">{v.title}</span><span className="qty">{v.quantity} · {f(v.revenue)}</span></li>)}</ol>
                  </div>
                </div>
              </section>
            );
          })}
          {!data.totals.length && <div className="card ep-empty"><b>No paid orders in this period</b><span>Refunded and unpaid orders are not counted.</span></div>}

          <div className="ep-panel">
            <div className="ep-panel-head"><h4>Low stock</h4><span>Tracked variants with 5 or fewer left, per market</span></div>
            <table className="ep-table"><thead><tr><th>Product</th><th>SKU</th><th>Market</th><th className="r">Left</th></tr></thead>
              <tbody>{data.lowStock.map((l, i) => <tr key={i}><td>{l.product}{l.variant ? ` — ${l.variant}` : ""}</td><td>{l.sku ?? "–"}</td><td>{l.market}</td><td className="r strong">{l.quantity}</td></tr>)}
                {!data.lowStock.length && <tr><td colSpan={4} className="ep-none">Nothing is running low.</td></tr>}</tbody></table>
          </div>
        </>
      )}

      {tr && (
        <>
          <div className="ep-panel">
            <div className="ep-panel-head"><h4>Visitor funnel</h4><span>Sessions that reached each step</span></div>
            <table className="ep-table"><tbody>
              {([["Visits", tr.funnel.sessions], ["Viewed a product", tr.funnel.view_item], ["Added to cart", tr.funnel.add_to_cart], ["Started checkout", tr.funnel.begin_checkout], ["Purchased", tr.funnel.purchase]] as [string, number][]).map(([l, n]) => (
                <tr key={l}><td>{l}</td><td className="r strong">{n}</td><td className="r dim">{tr.funnel.sessions ? `${Math.round((n / tr.funnel.sessions) * 100)}%` : "–"}</td></tr>
              ))}</tbody></table>
          </div>
          <div className="ep-two even">
            <div className="ep-panel">
              <div className="ep-panel-head"><h4>Traffic sources</h4><span>UTM links (Instagram bio, ads) are split out</span></div>
              <table className="ep-table"><thead><tr><th>Source / medium / campaign</th><th className="r">Visits</th><th className="r">Carts</th><th className="r">Orders</th></tr></thead>
                <tbody>{tr.sources.map((s, i) => <tr key={i}><td>{s.source}{s.medium ? ` / ${s.medium}` : ""}{s.campaign ? ` / ${s.campaign}` : ""}</td><td className="r">{s.sessions}</td><td className="r">{s.add_to_cart}</td><td className="r strong">{s.purchase}</td></tr>)}
                  {!tr.sources.length && <tr><td colSpan={4} className="ep-none">No visits recorded yet.</td></tr>}</tbody></table>
            </div>
            <div className="ep-panel">
              <div className="ep-panel-head"><h4>Exit pages</h4><span>Last page before leaving without buying</span></div>
              <table className="ep-table"><thead><tr><th>Page</th><th className="r">Exits</th><th className="r">Exit rate</th></tr></thead>
                <tbody>{tr.exitPages.map((p) => <tr key={p.path}><td>{p.path}</td><td className="r">{p.exits}</td><td className="r">{p.exitRate}%</td></tr>)}
                  {!tr.exitPages.length && <tr><td colSpan={3} className="ep-none">No data yet.</td></tr>}</tbody></table>
            </div>
          </div>
          <div className="ep-panel">
            <div className="ep-panel-head"><h4>Most visited pages</h4><span>Average active time on page</span></div>
            <table className="ep-table"><thead><tr><th>Page</th><th className="r">Views</th><th className="r">Avg time</th></tr></thead>
              <tbody>{tr.topPages.map((p) => <tr key={p.path}><td>{p.title || p.path}<span className="dim"> {p.title ? p.path : ""}</span></td><td className="r">{p.views}</td><td className="r">{secs(p.avgSeconds)}</td></tr>)}
                {!tr.topPages.length && <tr><td colSpan={3} className="ep-none">No page views yet.</td></tr>}</tbody></table>
          </div>
        </>
      )}
    </div>
  );
}
