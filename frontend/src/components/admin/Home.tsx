"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { auth, money, type AdminUser } from "@/lib/api";
import { ROUTE_PERMS, useCan } from "@/lib/perms";
import { useApi } from "./hooks";
import { useAdminMarket } from "@/lib/adminMarket";
import { actions } from "./nav";
import { Delta, Spark } from "./Dashboard";

type Cur = { currency: string; today: number; yesterday: number; week: number; prevWeek: number; ordersToday: number; ordersWeek: number; series: number[] };
type Overview = {
  currencies: Cur[];
  todo: { toFulfil: number; unpaid: number; highRisk: number; lowStock: number; outOfStock: number };
  recent: { id: string; number: number; total: number; currency: string; status: string; paymentStatus: string; channel: string; createdAt: string; risk: string | null; market: string; customer: string }[];
  topProducts: { title: string; quantity: number }[];
  stock: { product: string; variant: string; sku: string | null; market: string; quantity: number }[];
  visitors: { sessions: number; purchases: number; conversion: number; today: number };
};
type Status = { products: number; activeProducts: number; markets: number; toFulfil: number; stripeConfigured: boolean; webhookConfigured: boolean };

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};
const payTone = (o: { status: string; paymentStatus: string }) =>
  o.status === "cancelled" ? ["Cancelled", "neutral"] : o.paymentStatus === "paid" ? [o.status === "fulfilled" ? "Fulfilled" : "To fulfil", o.status === "fulfilled" ? "good" : "warn"] : o.paymentStatus === "refunded" ? ["Refunded", "neutral"] : o.paymentStatus === "failed" ? ["Failed", "bad"] : ["Unpaid", "warn"];

export function Home() {
  const router = useRouter();
  const { market } = useAdminMarket();
  const { can } = useCan();
  const { data, error } = useApi<Overview>(`/analytics/home?x=1${market ? `&market=${market}` : ""}`);
  const { data: status } = useApi<Status>("/analytics/status");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  useEffect(() => { auth<AdminUser>("/me").then(setUser).catch(() => {}); }, []);

  const allowed = actions.filter((a) => { const p = ROUTE_PERMS.find(([prefix]) => a.href.startsWith(prefix))?.[1]; return !p || can(p); });
  const matches = q ? allowed.filter((a) => a.label.toLowerCase().includes(q.toLowerCase())) : [];

  const t = data?.todo;
  const attention = t && [
    { n: t.toFulfil, label: "to fulfil", href: "/admin/orders?status=open", tone: "warn" },
    { n: t.unpaid, label: "unpaid checkouts", href: "/admin/orders", tone: "info" },
    { n: t.highRisk, label: "high-risk orders", href: "/admin/orders", tone: "bad" },
    { n: t.outOfStock, label: "out of stock", href: "/admin/products", tone: "bad" },
    { n: t.lowStock, label: "running low", href: "/admin/products", tone: "warn" },
  ].filter((x) => x.n > 0);

  const setup = status && (status.products === 0 || !status.stripeConfigured || !status.webhookConfigured) && [
    { done: status.products > 0, title: "Add your first product", body: "Pick the markets it sells in and set a price per market.", cta: "Add product", href: "/admin/products/new" },
    { done: status.stripeConfigured, title: "Connect Stripe", body: "Add STRIPE_SECRET_KEY to backend/.env, then restart the API.", cta: "How it works", href: "https://docs.stripe.com/keys" },
    { done: status.webhookConfigured, title: "Add the Stripe webhook", body: "Add STRIPE_WEBHOOK_SECRET so paid orders are marked automatically.", cta: "How it works", href: "https://docs.stripe.com/webhooks" },
  ];

  const setupTop = status?.products === 0;
  const setupCard = setup && (
        <div className="ep-panel hm-setup">
          <div className="ep-panel-head"><h4>Get your store ready</h4><span>{setup.filter((s) => s.done).length} of {setup.length} done</span></div>
          <ul>
            {setup.map((s) => (
              <li key={s.title} className={s.done ? "done" : ""}>
                <i aria-hidden="true">{s.done ? "✓" : ""}</i>
                <div><b>{s.title}</b><span>{s.body}</span></div>
                {!s.done && (s.href.startsWith("http") ? <a className="btn-link" href={s.href} target="_blank" rel="noreferrer">{s.cta}</a> : <Link className="btn-link" href={s.href}>{s.cta}</Link>)}
              </li>
            ))}
          </ul>
        </div>
  );

  return (
    <div className="home ep hm">
      <div className="hm-head">
        <div>
          <h1>{greeting()}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>
          <p className="ep-sub">{new Date().toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" })} · {market ? `${market} market` : "all markets"}</p>
        </div>
        <div className="hm-actions">
          {can("orders.manage") && <Link href="/admin/sell" className="btn-link">Sell in store</Link>}
          {can("orders.manage") && <Link href="/admin/orders/new" className="btn-link">Create order</Link>}
          {can("products.manage") && <Link href="/admin/products/new" className="btn-link primary">Add product</Link>}
        </div>
      </div>

      <div className="finder hm-find">
        <input
          placeholder="Search actions: add product, orders, gift cards…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setHi((h) => Math.min(h + 1, matches.length - 1));
            if (e.key === "ArrowUp") setHi((h) => Math.max(h - 1, 0));
            if (e.key === "Enter" && matches[hi]) router.push(matches[hi].href);
          }}
        />
        {!!matches.length && <ul>{matches.map((a, i) => <li key={a.href}><Link href={a.href} className={i === hi ? "on" : ""}>{a.label}</Link></li>)}</ul>}
      </div>

      {setupTop && setupCard}

      {error && <p className="muted">Live numbers are available to staff with analytics access.</p>}
      {!data && !error && <div className="ep-skel" aria-busy="true"><i /><i /><i /></div>}

      {data && (
        <>
          {attention && (
            <div className="hm-attn" aria-label="Needs attention">
              {attention.length ? attention.map((a) => <Link key={a.label} href={a.href} className={`hm-chip ${a.tone}`}><b>{a.n}</b> {a.label}</Link>) : <span className="hm-chip good">✓ Nothing needs your attention</span>}
            </div>
          )}

          {data.currencies.map((c) => (
            <section key={c.currency} className="ep-cur">
              <div className="ep-curhead"><h3>{c.currency}</h3><span className="muted">sales, net of tax</span></div>
              <div className="ep-kpis hm-kpis">
                <div className="ep-kpi big">
                  <div className="ep-kpi-label">Today<span>{c.ordersToday} order{c.ordersToday === 1 ? "" : "s"} so far</span></div>
                  <div className="ep-kpi-value">{money(c.today, c.currency)}</div>
                  <Delta now={c.today} before={c.yesterday} />
                  <Spark values={c.series} />
                </div>
                <div className="ep-kpi"><div className="ep-kpi-label">Yesterday</div><div className="ep-kpi-value">{money(c.yesterday, c.currency)}</div></div>
                <div className="ep-kpi"><div className="ep-kpi-label">Last 7 days<span>{c.ordersWeek} orders</span></div><div className="ep-kpi-value">{money(c.week, c.currency)}</div><Delta now={c.week} before={c.prevWeek} /></div>
                <div className="ep-kpi"><div className="ep-kpi-label">Avg order<span>last 7 days</span></div><div className="ep-kpi-value">{money(c.ordersWeek ? Math.round(c.week / c.ordersWeek) : 0, c.currency)}</div></div>
              </div>
            </section>
          ))}
          {!data.currencies.length && <div className="card ep-empty"><b>No paid orders in the last 14 days</b><span>Sales appear here as soon as a customer pays.</span></div>}

          <div className="ep-two">
            <div className="ep-panel">
              <div className="ep-panel-head"><h4>Recent orders</h4><Link href="/admin/orders">View all</Link></div>
              <table className="ep-table">
                <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th className="r">Total</th></tr></thead>
                <tbody>
                  {data.recent.map((o) => { const [label, tone] = payTone(o); return (
                    <tr key={o.id} className="hm-row" onClick={() => router.push(`/admin/orders/${o.id}`)}>
                      <td><b>#{o.number}</b><div className="hm-sub">{ago(o.createdAt)} · {o.market}{o.channel === "in_store" ? " · in-store" : ""}</div></td>
                      <td>{o.customer}</td>
                      <td><span className={`hm-pill ${tone}`}>{label}</span>{o.risk === "high" && <span className="hm-pill bad">High risk</span>}</td>
                      <td className="r strong">{money(o.total, o.currency)}</td>
                    </tr>
                  ); })}
                  {!data.recent.length && <tr><td colSpan={4} className="ep-none">No orders yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="hm-col">
              <div className="ep-panel">
                <div className="ep-panel-head"><h4>Visitors</h4><span>last 7 days</span></div>
                <div className="hm-vis">
                  <div><b>{data.visitors.sessions}</b><span>visits</span></div>
                  <div><b>{data.visitors.today}</b><span>today</span></div>
                  <div><b>{data.visitors.conversion}%</b><span>bought</span></div>
                </div>
                {can("analytics.view") && <Link href="/admin/analytics" className="hm-more">Sales insights and traffic →</Link>}
              </div>
              <div className="ep-panel">
                <div className="ep-panel-head"><h4>Best sellers</h4><span>last 7 days</span></div>
                <ol className="ep-top-list">
                  {data.topProducts.map((p, i) => <li key={p.title}><i className="bar" style={{ width: `${Math.round((p.quantity / (data.topProducts[0]?.quantity || 1)) * 100)}%` }} /><span className="rank">{i + 1}</span><span className="name">{p.title}</span><span className="qty">{p.quantity} sold</span></li>)}
                  {!data.topProducts.length && <li className="ep-none">No sales this week.</li>}
                </ol>
              </div>
            </div>
          </div>

          {data.stock.length > 0 && (
            <div className="ep-panel">
              <div className="ep-panel-head"><h4>Stock to reorder</h4><Link href="/admin/products">Products</Link></div>
              <table className="ep-table">
                <thead><tr><th>Product</th><th>SKU</th><th>Market</th><th className="r">Left</th></tr></thead>
                <tbody>{data.stock.map((s, i) => <tr key={i}><td>{s.product}{s.variant ? ` — ${s.variant}` : ""}</td><td className="dim">{s.sku ?? "–"}</td><td>{s.market}</td><td className="r"><span className={`hm-pill ${s.quantity <= 0 ? "bad" : "warn"}`}>{s.quantity <= 0 ? "Out" : s.quantity}</span></td></tr>)}</tbody>
              </table>
            </div>
          )}
          {!setupTop && setupCard}
        </>
      )}
    </div>
  );
}
