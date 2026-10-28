"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { auth, money, type AdminUser } from "@/lib/api";
import { useApi } from "./hooks";
import { actions } from "./nav";

type Summary = {
  markets: { code: string; currency: string; orders: number; revenue: number }[];
  customers: number; pendingOrders: number;
};
type Status = { products: number; activeProducts: number; markets: number; toFulfil: number; stripeConfigured: boolean; webhookConfigured: boolean };

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export function Home() {
  const router = useRouter();
  const { data: summary } = useApi<Summary>("/analytics/summary?days=30");
  const { data: status } = useApi<Status>("/analytics/status");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  useEffect(() => { auth<AdminUser>("/me").then(setUser).catch(() => {}); }, []);

  const matches = q ? actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase())) : [];
  const totalOrders = summary?.markets.reduce((s, m) => s + m.orders, 0) ?? 0;

  const cards = status && [
    status.products === 0
      ? { tone: "amber", title: "Add your first product", body: "Pick the markets it sells in, then set a price per market (GBP, USD, CAD).", cta: "Add product", href: "/admin/products?new=1" }
      : { tone: "amber", title: `${status.activeProducts} of ${status.products} products are live`, body: "Draft products are hidden from the storefront. Open one to publish it.", cta: "Review products", href: "/admin/products" },
    status.stripeConfigured
      ? { tone: "green", title: "Stripe is connected", body: status.webhookConfigured ? "Payments and the webhook are configured." : "Add STRIPE_WEBHOOK_SECRET so paid orders are marked automatically.", cta: "View orders", href: "/admin/orders" }
      : { tone: "blue", title: "Connect Stripe to take payments", body: "Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to backend/.env, then restart the API.", cta: "How it works", href: "https://docs.stripe.com/keys" },
    { tone: "violet", title: `${status.markets} active market${status.markets === 1 ? "" : "s"}`, body: "Currency, tax and shipping rates are set per market. Add a market when you open a new location.", cta: "Manage markets", href: "/admin/markets" },
  ];

  return (
    <div className="home">
      <div className="strip">
        <span className="muted">Last 30 days</span>
        <div className="metrics">
          {summary?.markets.map((m) => (
            <div key={m.code}><span>Sales · {m.code}</span><b>{money(m.revenue, m.currency)}</b></div>
          ))}
          <div><span>Orders</span><b>{totalOrders}</b></div>
          <div><span>Customers</span><b>{summary?.customers ?? "–"}</b></div>
        </div>
      </div>

      <h1 className="hello">
        {greeting()}{user?.name ? `, ${user.name}` : ""}!<br />
        Let’s continue growing your business.
      </h1>

      <div className="finder">
        <input
          placeholder="What would you like to do? e.g. add product, orders…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setHi((h) => Math.min(h + 1, matches.length - 1));
            if (e.key === "ArrowUp") setHi((h) => Math.max(h - 1, 0));
            if (e.key === "Enter" && matches[hi]) router.push(matches[hi].href);
          }}
        />
        {!!matches.length && (
          <ul>
            {matches.map((a, i) => (
              <li key={a.href}><Link href={a.href} className={i === hi ? "on" : ""}>{a.label}</Link></li>
            ))}
          </ul>
        )}
      </div>

      <div className="chips">
        <Link href="/admin/orders?status=open" className="pill">Fulfil orders {!!status?.toFulfil && <span className="count">{status.toFulfil}</span>}</Link>
        <Link href="/admin/products?new=1" className="pill">Add product</Link>
        <Link href="/admin/markets?new=1" className="pill">Add market</Link>
      </div>

      <div className="tiles">
        {cards?.map((c) => (
          <div key={c.title} className="tile">
            <div className={`art ${c.tone}`} aria-hidden="true"><i /><i /><i /></div>
            <h4>{c.title}</h4>
            <p>{c.body}</p>
            {c.href.startsWith("http") ? <a className="pill" href={c.href} target="_blank" rel="noreferrer">{c.cta}</a> : <Link className="pill" href={c.href}>{c.cta}</Link>}
          </div>
        ))}
      </div>
    </div>
  );
}
