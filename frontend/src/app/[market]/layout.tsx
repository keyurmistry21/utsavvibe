import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarkets, getPolicyLinks, getSite, menuHref } from "@/lib/store";
import { CartProvider } from "@/components/store/cart";
import { CartLink } from "@/components/store/CartLink";
import { MarketSwitcher } from "@/components/store/MarketSwitcher";
import { AccountLink } from "@/components/store/AccountLink";

export default async function MarketLayout({ children, params }: { children: React.ReactNode; params: Promise<{ market: string }> }) {
  const { market } = await params;
  const code = market.toLowerCase();
  const [markets, site, policies] = await Promise.all([getMarkets(), getSite(), getPolicyLinks()]);
  const current = markets.find((m) => m.code.toLowerCase() === code);
  if (!current) notFound();

  return (
    <CartProvider market={code}>
      <div className="store sf">
        <div className="announce">{site.announcement || <>Free shipping on orders over {current.shippingRates[0]?.freeOverAmount != null ? new Intl.NumberFormat("en", { style: "currency", currency: current.currency, maximumFractionDigits: 0 }).format(current.shippingRates[0].freeOverAmount / 100) : "—"} · Shipping to {current.name}</>}</div>
        <header className="sf-head">
          <Link href={`/${code}`} className="logo">{site.storeName}</Link>
          <nav>
            {site.headerMenu.map((m, i) => <Link key={i} href={menuHref(code, m.url)}>{m.label}</Link>)}
          </nav>
          <div className="sf-right">
            <MarketSwitcher current={{ code: current.code, currency: current.currency }} markets={markets.map((m) => ({ id: m.id, code: m.code, name: m.name, currency: m.currency, on: m.id === current.id }))} />
            <AccountLink market={code} />
            <CartLink market={code} />
          </div>
        </header>
        <main className="sf-main">{children}</main>
        <footer className="sf-foot">
          <div>
            <b>{site.storeName}</b>
            <p>{site.tagline}</p>
            {site.footerMenu.length > 0 && <ul className="sf-footnav">{site.footerMenu.map((m, i) => <li key={i}><Link href={menuHref(code, m.url)}>{m.label}</Link></li>)}</ul>}
          </div>
          {policies.length > 0 && <ul className="sf-footnav sf-policies">{policies.map((p) => <li key={p.key}><Link href={`/${code}/policies/${p.key}`}>{p.title}</Link></li>)}</ul>}
          <div className="muted">
            Secure payments by Stripe · {current.taxInclusive ? "Prices include tax" : "Tax added at checkout"}
          </div>
        </footer>
      </div>
    </CartProvider>
  );
}
