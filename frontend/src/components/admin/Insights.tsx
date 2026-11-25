"use client";

import { useMemo, useState } from "react";
import { money } from "@/lib/api";
import { today, ymd } from "@/lib/dates";
import { useAdminMarket } from "@/lib/adminMarket";
import { useApi } from "./hooks";
import { DateRangePicker } from "./DateRangePicker";
import { Banner } from "./Banner";
import { AreaChart, Donut, HBars, HeatStrip } from "./Charts";

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
  sources: { source: string; medium: string; campaign: string; sessions: number; add_to_cart: number; purchase: number; revenue?: Record<string, number> }[];
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
  const { data: tax } = useApi<{ currency: string; market: string; region: string; orders: number; sales: number; tax: number; parts?: Record<string, number> }[]>(`/analytics/tax?${qs}`);
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

      <Banner title="Visitors summary" ring={{ value: tr ? `${tr.conversionRate}%` : "–", label: "conversion", segs: [{ cls: "ok", n: tr?.funnel.purchase ?? 0 }, { cls: "arch", n: Math.max(0, (tr?.funnel.sessions ?? 0) - (tr?.funnel.purchase ?? 0)) }] }} stats={[
        { label: "Visits", value: tr?.funnel.sessions ?? "–", tone: "arch" },
        { label: "Viewed a product", value: tr?.funnel.view_item ?? "–", tone: "low" },
        { label: "Added to cart", value: tr?.funnel.add_to_cart ?? "–", tone: "low" },
        { label: "Purchased", value: tr?.funnel.purchase ?? "–", tone: "ok" },
      ]}>
        <span className="bn-note">Visitors in the chosen days. Conversion is the share of visits that ended in a purchase.</span>
      </Banner>
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
                <div className="ep-banner">
                <div className="ep-curhead"><h3>{t.currency}</h3>{range && <span className="ep-bperiod">{range.from} → {range.to}</span>}</div>
                <div className="ep-kpis ins-kpis">
                  <div className="ep-kpi big"><div className="ep-kpi-label">Total sales<span>net of tax, paid only</span></div><div className="ep-kpi-value">{f(t.sales)}</div></div>
                  <div className="ep-kpi"><div className="ep-kpi-label">Orders<span>paid</span></div><div className="ep-kpi-value">{t.orders}</div><span className="ep-delta flat">{data.pending} pending / unpaid</span></div>
                  <div className="ep-kpi"><div className="ep-kpi-label">Average order value</div><div className="ep-kpi-value">{f(t.aov)}</div></div>
                  <div className="ep-kpi"><div className="ep-kpi-label">Conversion rate<span>visits → purchase</span></div><div className="ep-kpi-value">{tr ? `${tr.conversionRate}%` : "…"}</div></div>
                  <div className="ep-kpi"><div className="ep-kpi-label">Top location</div><div className="ep-kpi-value sm">{topL ? topL.name : "–"}</div>{topL && <span className="ep-delta flat">{f(topL.sales)}</span>}</div>
                  <div className="ep-kpi"><div className="ep-kpi-label">Top salesperson</div><div className="ep-kpi-value sm">{topS ? topS.name : "–"}</div>{topS && <span className="ep-delta flat">{f(topS.sales)}</span>}</div>
                </div>
                </div>
                <div className="card ep-card">
                  <div className="ep-panel-head"><h4>Sales over time</h4>
                    {!oneDay && <div className="ep-seg"><button className={!hourlyView ? "on" : ""} onClick={() => setHourlyView(false)}>Daily</button><button className={hourlyView ? "on" : ""} onClick={() => setHourlyView(true)}>By hour of day</button></div>}
                  </div>
                  {oneDay || hourlyView ? <HeatStrip values={hours} fmt={f} /> : <AreaChart points={daily.map((p) => ({ label: p.date.slice(5), value: p.sales }))} fmt={f} />}
                </div>
                <div className="ep-two even">
                  <div className="ep-panel">
                    <div className="ep-panel-head"><h4>Sales by channel</h4><span>Online vs in-store QR</span></div>
                    <Donut slices={ch.map((c) => ({ label: CH[c.channel] ?? c.channel, value: c.sales }))} center={String(ch.reduce((a, c) => a + c.orders, 0))} sub="orders" fmt={f} />
                  </div>
                  <div className="ep-panel">
                    <div className="ep-panel-head"><h4>In-store by salesperson</h4><span>QR payments</span></div>
                    <HBars fmt={f} empty="No in-store sales." items={data.salespeople.filter((s) => s.currency === t.currency).map((s) => ({ label: s.name, value: s.sales, note: `${s.orders} order${s.orders === 1 ? "" : "s"}` }))} />
                  </div>
                </div>
                <div className="ep-two even">
                  <div className="ep-panel">
                    <div className="ep-panel-head"><h4>In-store by location</h4></div>
                    <HBars fmt={f} empty="No in-store sales." items={data.locations.filter((s) => s.currency === t.currency).map((s) => ({ label: s.name, value: s.sales, note: `${s.orders} order${s.orders === 1 ? "" : "s"}` }))} />
                  </div>
                  <div className="ep-panel">
                    <div className="ep-panel-head"><h4>Top products and variants</h4><span>By units sold</span></div>
                    <HBars empty="No sales yet." color="#f97203" items={data.topVariants.filter((v) => v.currency === t.currency).slice(0, 8).map((v) => ({ label: v.title, value: v.quantity, note: f(v.revenue) }))} />
                  </div>
                </div>
              </section>
            );
          })}
          {!data.totals.length && <div className="card ep-empty"><b>No paid orders in this period</b><span>Refunded and unpaid orders are not counted.</span></div>}

          <div className="ep-panel">
            <div className="ep-panel-head"><h4>Tax collected by province or state</h4><span>Paid orders, after refunds. Give this to your accountant.</span></div>
            <div style={{ marginBottom: 16 }}><HBars color="#2f80ed" empty="No paid orders in this period." fmt={(n) => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} items={(tax ?? []).slice().sort((a, b) => b.tax - a.tax).slice(0, 8).map((t) => ({ label: `${t.market} · ${t.region}`, value: t.tax / 100, note: `${t.orders} order${t.orders === 1 ? "" : "s"} · ${t.currency}` }))} /></div>
            <table className="ep-table"><thead><tr><th>Market</th><th>Province / state</th><th className="r">Orders</th><th className="r">Sales (net)</th><th>Parts</th><th className="r">Tax collected</th></tr></thead>
              <tbody>{tax?.map((t, i) => <tr key={i}><td>{t.market}</td><td>{t.region}</td><td className="r">{t.orders}</td><td className="r">{money(t.sales, t.currency)}</td><td className="dim">{Object.entries(t.parts ?? {}).map(([n, a]) => `${n} ${money(a, t.currency)}`).join(" · ") || "–"}</td><td className="r strong">{money(t.tax, t.currency)}</td></tr>)}
                {tax && !tax.length && <tr><td colSpan={6} className="ep-none">No paid orders in this period.</td></tr>}</tbody></table>
          </div>

          <div className="ep-panel">
            <div className="ep-panel-head"><h4>Low stock</h4><span>Tracked variants with 5 or fewer left, per market</span></div>
            <HBars empty="Nothing is running low." items={data.lowStock.map((l) => ({ label: `${l.product}${l.variant ? ` — ${l.variant}` : ""}`, value: l.quantity, note: `${l.market}${l.sku ? ` · ${l.sku}` : ""}`, color: l.quantity <= 2 ? "#d92d20" : "#e0a100" }))} />
          </div>
        </>
      )}

      {tr && (
        <>
          <div className="ep-panel">
            <div className="ep-panel-head"><h4>Visitor funnel</h4><span>Sessions that reached each step</span></div>
            <div className="fn">
              {([["Visits", tr.funnel.sessions], ["Viewed a product", tr.funnel.view_item], ["Added to cart", tr.funnel.add_to_cart], ["Started checkout", tr.funnel.begin_checkout], ["Purchased", tr.funnel.purchase]] as const).map(([l, n], i, arr) => {
                const top = Math.max(1, tr.funnel.sessions);
                const prev = i ? arr[i - 1][1] : n;
                return (
                  <div key={l} className="fn-row">
                    <div className="fn-label"><b>{l}</b>{i > 0 && <small>{prev ? `${Math.round((n / prev) * 100)}% of previous step` : "–"}</small>}</div>
                    <div className="fn-track"><i style={{ width: `${Math.max(n ? 2 : 0, Math.round((n / top) * 100))}%` }} /></div>
                    <div className="fn-num"><b>{n}</b><small>{tr.funnel.sessions ? `${Math.round((n / tr.funnel.sessions) * 100)}%` : "–"}</small></div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="ep-two even">
            <div className="ep-panel">
              <div className="ep-panel-head"><h4>Traffic sources</h4><span>UTM links (Instagram bio, ads) are split out</span></div>
              <Donut slices={tr.sources.slice(0, 6).map((x) => ({ label: `${x.source}${x.medium ? ` / ${x.medium}` : ""}`, value: x.sessions }))} center={String(tr.funnel.sessions)} sub="visits" />
              <table className="ep-table" style={{ marginTop: 18 }}><thead><tr><th>Source / medium / campaign</th><th className="r">Visits</th><th className="r">Carts</th><th className="r">Orders</th><th className="r">Sales</th></tr></thead>
                <tbody>{tr.sources.map((s, i) => <tr key={i}><td>{s.source}{s.medium ? ` / ${s.medium}` : ""}{s.campaign ? ` / ${s.campaign}` : ""}</td><td className="r">{s.sessions}</td><td className="r">{s.add_to_cart}</td><td className="r strong">{s.purchase}</td><td className="r">{Object.entries(s.revenue ?? {}).map(([c, a]) => money(a, c)).join(" · ") || "–"}</td></tr>)}
                  {!tr.sources.length && <tr><td colSpan={5} className="ep-none">No visits recorded yet.</td></tr>}</tbody></table>
            </div>
            <div className="ep-panel">
              <div className="ep-panel-head"><h4>Exit pages</h4><span>Last page before leaving without buying</span></div>
              <HBars color="#d92d20" empty="No data yet." items={tr.exitPages.slice(0, 8).map((p) => ({ label: p.path, value: p.exits, note: `${p.exitRate}% exit rate` }))} />
            </div>
          </div>
          <div className="ep-panel">
            <div className="ep-panel-head"><h4>Most visited pages</h4><span>Average active time on page</span></div>
            <HBars color="#27ae60" empty="No page views yet." items={tr.topPages.slice(0, 10).map((p) => ({ label: p.title || p.path, value: p.views, note: p.avgSeconds != null ? `${secs(p.avgSeconds)} on page` : undefined }))} />
          </div>
        </>
      )}
    </div>
  );
}
