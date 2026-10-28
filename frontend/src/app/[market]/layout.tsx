import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarkets, getSite, menuHref } from "@/lib/store";
import { CartProvider } from "@/components/store/cart";
import { CartLink } from "@/components/store/CartLink";

export default async function MarketLayout({ children, params }: { children: React.ReactNode; params: Promise<{ market: string }> }) {
  const { market } = await params;
  const code = market.toLowerCase();
  const [markets, site] = await Promise.all([getMarkets(), getSite()]);
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
            <details className="mkt">
              <summary>{current.code} · {current.currency}</summary>
              <ul>
                {markets.map((m) => (
                  <li key={m.code}><Link href={`/${m.code.toLowerCase()}`} className={m.id === current.id ? "on" : ""}>{m.name} ({m.currency})</Link></li>
                ))}
              </ul>
            </details>
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
          <div className="muted">
            Secure payments by Stripe · {current.taxInclusive ? "Prices include tax" : "Tax added at checkout"}
          </div>
        </footer>
      </div>
    </CartProvider>
  );
}
