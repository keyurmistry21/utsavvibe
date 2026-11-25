"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { money } from "@/lib/api";
import { PRESETS, today, type PresetKey } from "@/lib/dates";
import { useCan } from "@/lib/perms";
import { useApi } from "./hooks";
import { useAdminMarket } from "@/lib/adminMarket";
import { DateRangePicker } from "./DateRangePicker";

type Cur = { currency: string; markets: string[]; orders: number; revenue: number; tax: number; shipping: number; net: number; expenses: number; expenseCount: number; profit: number };
type Prev = { orders: number; revenue: number; net: number; expenses: number; profit: number };
type Summary = {
  from: string; to: string; days: number;
  markets: { code: string; currency: string; orders: number; revenue: number; tax: number; shipping: number }[];
  currencies: Cur[];
  previous: Record<string, Prev>;
  daily: ({ date: string } & Record<string, number | string>)[];
  topProducts: { title: string; quantity: number }[];
  customers: number; pendingOrders: number;
};
type Year = { year: number; currency: string; orders: number; revenue: number; tax: number; net: number; expenses: number; profit: number };

const fmtDay = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
const compact = (n: number, c: string) => new Intl.NumberFormat("en", { style: "currency", currency: c, notation: "compact", maximumFractionDigits: 1 }).format(n / 100);

// "+12% vs previous period". Up is good for earnings and profit, bad for expenses.
export function Delta({ now, before, goodWhenUp = true }: { now: number; before?: number; goodWhenUp?: boolean }) {
  if (before == null || (before === 0 && now === 0)) return <span className="ep-delta flat">No change</span>;
  if (before === 0) return <span className="ep-delta flat">New this period</span>;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  if (pct === 0) return <span className="ep-delta flat">No change</span>;
  const good = (pct > 0) === goodWhenUp;
  return <span className={`ep-delta ${good ? "good" : "bad"}`}>{pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%<em> vs previous</em></span>;
}

function Kpi({ label, value, hint, tone, big, children }: { label: string; value: string; hint?: string; tone?: "pos" | "neg"; big?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`ep-kpi ${big ? "big" : ""}`}>
      <div className="ep-kpi-label">{label}{hint && <span>{hint}</span>}</div>
      <div className={`ep-kpi-value ${tone ?? ""}`}>{value}</div>
      {children}
    </div>
  );
}

// Daily earnings for one currency as a plain list (used by the hero sparkline).
function dailySeries(s: Summary, cur: string) {
  const codes = s.markets.filter((m) => m.currency === cur).map((m) => m.code);
  return s.daily.map((d) => codes.reduce((a, c) => a + (Number(d[c]) || 0), 0));
}

// Tiny area line drawn inside the dark hero card.
export function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 220, H = 56, max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 4 - (v / max) * (H - 10)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg className="ep-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="epsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f97203" stopOpacity=".38" /><stop offset="1" stopColor="#f97203" stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="url(#epsg)" />
      <path d={line} fill="none" stroke="#f97203" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Earnings per day (per month for ranges over ~3 months) for ONE currency. Missing days are zeros so gaps are visible.
function Chart({ s, cur }: { s: Summary; cur: string }) {
  const [hot, setHot] = useState<number | null>(null);
  const codes = s.markets.filter((m) => m.currency === cur).map((m) => m.code);
  const monthly = s.days > 92;
  const pts = useMemo(() => {
    const sums = new Map<string, number>();
    for (const d of s.daily) {
      const k = monthly ? String(d.date).slice(0, 7) : String(d.date);
      sums.set(k, (sums.get(k) ?? 0) + codes.reduce((a, c) => a + (Number(d[c]) || 0), 0));
    }
    const out: { key: string; label: string; v: number }[] = [];
    const a = new Date(`${s.from}T00:00:00Z`), z = new Date(`${s.to}T00:00:00Z`);
    if (monthly) {
      for (let d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)); d <= z; d.setUTCMonth(d.getUTCMonth() + 1)) {
        const k = d.toISOString().slice(0, 7);
        out.push({ key: k, label: d.toLocaleDateString("en", { month: "short", year: "2-digit", timeZone: "UTC" }), v: sums.get(k) ?? 0 });
      }
    } else {
      for (let d = new Date(a); d <= z; d.setUTCDate(d.getUTCDate() + 1)) {
        const k = d.toISOString().slice(0, 10);
        out.push({ key: k, label: d.toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" }), v: sums.get(k) ?? 0 });
      }
    }
    return out;
  }, [s, cur, monthly]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(1, ...pts.map((p) => p.v));
  // round the top of the axis up to a tidy number
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / pow) * pow;
  const W = 720, H = 220, L = 54, R = 8, T = 10, B = 26, iw = W - L - R, ih = H - T - B;
  const bw = iw / pts.length;
  const cur_ = hot != null ? pts[hot] : null;
  const total = pts.reduce((a, p) => a + p.v, 0);
  if (!total) return <div className="ep-empty small">No sales in this period.</div>;
  return (
    <div className="ep-chart">
      <div className="ep-chart-read">{cur_ ? <><b>{money(cur_.v, cur)}</b><span>{cur_.label}</span></> : <><b>{money(total, cur)}</b><span>total in this period · hover a bar for {monthly ? "the month" : "the day"}</span></>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Earnings per ${monthly ? "month" : "day"} in ${cur}`} onMouseLeave={() => setHot(null)}>
        {[0, 1, 2, 3, 4].map((i) => {
          const y = T + ih - (ih * i) / 4;
          return <g key={i}><line x1={L} x2={W - R} y1={y} y2={y} className="ep-grid" /><text x={L - 8} y={y + 4} textAnchor="end" className="ep-axis">{compact((top * i) / 4, cur)}</text></g>;
        })}
        <defs><linearGradient id="epbar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7fb02a" /><stop offset="1" stopColor="#b6d97a" /></linearGradient></defs>
        {pts.map((p, i) => {
          const h = (p.v / top) * ih;
          return (
            <g key={p.key} onMouseEnter={() => setHot(i)}>
              <rect x={L + i * bw} y={T} width={bw} height={ih} fill="transparent" />
              <rect x={L + i * bw + Math.min(bw * 0.18, 4)} y={T + ih - Math.max(h, p.v ? 2 : 0)} width={Math.max(bw - Math.min(bw * 0.36, 8), 1)} height={Math.max(h, p.v ? 2 : 0)} rx={Math.min(3, bw / 4)} className={`ep-bar ${hot === i ? "hot" : ""}`} />
            </g>
          );
        })}
        {pts.length > 3 && <g><line x1={L} x2={W - R} y1={T + ih - (total / pts.length / top) * ih} y2={T + ih - (total / pts.length / top) * ih} className="ep-avg" /><text x={L + 6} y={T + ih - (total / pts.length / top) * ih - 6} textAnchor="start" className="ep-avg-label">avg {compact(total / pts.length, cur)}</text></g>}
        {[0, Math.floor((pts.length - 1) / 2), pts.length - 1].filter((v, i, a) => a.indexOf(v) === i && pts.length > 1).map((i) => (
          <text key={i} x={Math.min(Math.max(L + i * bw + bw / 2, L + 18), W - R - 18)} y={H - 6} textAnchor="middle" className="ep-axis">{pts[i].label}</text>
        ))}
      </svg>
    </div>
  );
}

export function Dashboard() {
  const { can } = useCan();
  const { market } = useAdminMarket();
  const [preset, setPreset] = useState<PresetKey>("1m");
  const [custom, setCustom] = useState({ from: "", to: today() });
  const range = useMemo(() => {
    if (preset === "custom") return custom.from && custom.to && custom.from <= custom.to ? custom : null;
    return { from: PRESETS.find((p) => p.key === preset)!.from(), to: today() };
  }, [preset, custom]);
  const m = market ? `&market=${market}` : "";
  const { data, error } = useApi<Summary>(range ? `/analytics/summary?from=${range.from}&to=${range.to}${m}` : "/analytics/summary?days=30");
  const { data: years } = useApi<Year[]>(`/analytics/yearly?x=1${m}`);
  const customErr = preset === "custom" && !range && custom.from && custom.to ? "The start date must be on or before the end date." : "";
  const ready = !!data && !customErr;

  return (
    <div className="ep">
      <div className="ep-top">
        <div>
          <h2>Earnings</h2>
          <p className="ep-sub">What you earned, spent and kept{market ? ` · ${market} market only` : " · all markets"}</p>
        </div>
        {can("expenses.view") && <Link href="/admin/expenses" className="btn-link">Expenses</Link>}
      </div>

      <div className="ep-filter">
        <div className="ep-seg" role="group" aria-label="Date range">
          {PRESETS.map((p) => <button key={p.key} className={preset === p.key ? "on" : ""} onClick={() => setPreset(p.key)}>{p.label}</button>)}
          {/* opening Custom starts from the range you were just looking at, so it never lands on an empty form */}
          <button className={preset === "custom" ? "on" : ""} onClick={() => { if (preset !== "custom" && range) setCustom({ from: range.from, to: range.to }); setPreset("custom"); }}>Custom</button>
        </div>
        {preset === "custom" && <DateRangePicker from={custom.from} to={custom.to} onChange={(from, to) => setCustom({ from, to })} />}
        {ready && <div className="ep-period">{fmtDay(data.from)} – {fmtDay(data.to)}</div>}
      </div>
      {customErr && <div className="error">{customErr}</div>}
      {error && <div className="error">{error}</div>}
      {!data && !error && !customErr && range && <div className="ep-skel" aria-busy="true"><i /><i /><i /></div>}

      {ready && (
        <>
          {data.currencies.map((c) => {
            const p = data.previous?.[c.currency];
            return (
              <section key={c.currency} className="ep-cur">
                <div className="ep-banner">
                <div className="ep-curhead"><h3>{c.currency}</h3>{c.markets.map((mk) => <span key={mk} className="chip">{mk}</span>)}</div>
                <div className="ep-kpis">
                  <Kpi big label="Total earnings" hint="paid orders incl. tax" value={money(c.revenue, c.currency)}><Delta now={c.revenue} before={p?.revenue} /><Spark values={dailySeries(data, c.currency)} /></Kpi>
                  <Kpi label="Orders" value={String(c.orders)}><Delta now={c.orders} before={p?.orders} /></Kpi>
                  <Kpi label="Net sales" hint={`after ${money(c.tax, c.currency)} tax`} value={money(c.net, c.currency)}><Delta now={c.net} before={p?.net} /></Kpi>
                  <Kpi label="Expenses" hint={c.expenseCount ? `${c.expenseCount} item${c.expenseCount === 1 ? "" : "s"}` : undefined} value={money(c.expenses, c.currency)}><Delta now={c.expenses} before={p?.expenses} goodWhenUp={false} /></Kpi>
                  <Kpi label="Profit" hint={c.net > 0 ? `${Math.round((c.profit / c.net) * 100)}% margin` : "net sales − expenses"} tone={c.profit < 0 ? "neg" : "pos"} value={money(c.profit, c.currency)}><Delta now={c.profit} before={p?.profit} /></Kpi>
                </div>
                </div>
                <div className="card ep-card"><h4>Earnings over time</h4><Chart s={data} cur={c.currency} /></div>
              </section>
            );
          })}
          {!data.currencies.length && (
            <div className="card ep-empty"><b>No paid orders or expenses in this period</b><span>Try a longer range. Refunded orders are not counted.</span></div>
          )}

          <div className="ep-two">
            <div className="ep-panel">
              <div className="ep-panel-head"><h4>Sales by market</h4><span>Paid orders in this period</span></div>
              <table className="ep-table">
                <thead><tr><th>Market</th><th className="r">Orders</th><th className="r">Revenue</th><th className="r">Tax</th><th className="r">Shipping</th></tr></thead>
                <tbody>
                  {data.markets.map((r) => { const tot = data.markets.filter((x) => x.currency === r.currency).reduce((a, x) => a + x.revenue, 0) || 1; return <tr key={r.code}><td><span className="ep-code">{r.code}</span><span className="ep-cur-tag">{r.currency}</span></td><td className="r">{r.orders}</td><td className="r strong ep-sharecell"><span>{money(r.revenue, r.currency)}</span><i className="ep-share" style={{ width: `${Math.round((r.revenue / tot) * 100)}%` }} /></td><td className="r dim">{money(r.tax, r.currency)}</td><td className="r dim">{money(r.shipping, r.currency)}</td></tr>; })}
                  {!data.markets.length && <tr><td colSpan={5} className="ep-none">No paid orders in this period.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="ep-panel">
              <div className="ep-panel-head"><h4>Top products</h4><span>By units sold</span></div>
              <ol className="ep-top-list">
                {data.topProducts.map((t, i) => <li key={t.title}><i className="bar" style={{ width: `${Math.round((t.quantity / (data.topProducts[0]?.quantity || 1)) * 100)}%` }} /><span className="rank">{i + 1}</span><span className="name">{t.title}</span><span className="qty">{t.quantity} sold</span></li>)}
                {!data.topProducts.length && <li className="ep-none">No sales in this period.</li>}
              </ol>
            </div>
          </div>
        </>
      )}

      <div className="ep-panel">
        <div className="ep-panel-head"><h4>Yearly revenue</h4><span>Calendar years, every currency on its own row</span></div>
        <table className="ep-table ep-year">
          <thead><tr><th>Year</th><th>Currency</th><th className="r">Orders</th><th className="r">Revenue</th><th className="r">Net sales</th><th className="r">Expenses</th><th className="r">Profit</th></tr></thead>
          <tbody>
            {years?.map((y, i) => {
              const first = i === 0 || years[i - 1].year !== y.year;
              return (
                <tr key={y.year + y.currency} className={first ? "ep-yfirst" : ""}>
                  <td className="ep-ycell">{first && <span className="ep-year-pill">{y.year}</span>}</td>
                  <td><span className="ep-cur-tag">{y.currency}</span></td>
                  <td className="r">{y.orders}</td>
                  <td className="r strong">{money(y.revenue, y.currency)}</td>
                  <td className="r dim">{money(y.net, y.currency)}</td>
                  <td className="r dim">{y.expenses ? `−${money(y.expenses, y.currency)}` : money(0, y.currency)}</td>
                  <td className="r"><span className={`ep-profit ${y.profit < 0 ? "neg" : "pos"}`}>{money(y.profit, y.currency)}</span></td>
                </tr>
              );
            })}
            {years && !years.length && <tr><td colSpan={7} className="ep-none">No sales or expenses yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {ready && <p className="ep-foot">Earnings = what customers paid on paid orders (refunds excluded). Each currency is shown on its own and never added to another.</p>}
    </div>
  );
}
