import Link from "next/link";
import { Mukta } from "next/font/google";
import localFont from "next/font/local";
import "../theme.css";
import { brand } from "@/lib/brand";
import { notFound } from "next/navigation";
import { getMarkets, getPolicyLinks, getSite, menuHref } from "@/lib/store";
import { CartProvider } from "@/components/store/cart";
import { Header } from "@/components/store/Header";
import { WishlistProvider } from "@/components/store/wishlistContext";
import { SitePopup } from "@/components/store/SitePopup";
import { Tracker } from "@/components/store/Tracker";
import { ConsentBanner, CookieSettingsLink } from "@/components/store/ConsentBanner";

const body = Mukta({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--f-body", display: "swap" });
const display = localFont({ src: "../../../public/theme/fonts/Qasira.ttf", weight: "400", variable: "--f-display", display: "swap" });

export default async function MarketLayout({ children, params }: { children: React.ReactNode; params: Promise<{ market: string }> }) {
  const { market } = await params;
  const code = market.toLowerCase();
  const [markets, site, policies] = await Promise.all([getMarkets(), getSite(), getPolicyLinks()]);
  const current = markets.find((m) => m.code.toLowerCase() === code);
  if (!current) notFound();

  return (
    <CartProvider market={code}>
      <WishlistProvider>
      <Tracker />
      <ConsentBanner />
      <div className={`store sf theme ${body.variable} ${display.variable}`}>
        <div className="announce">{site.announcement || <>Free shipping on orders over {current.shippingRates[0]?.freeOverAmount != null ? new Intl.NumberFormat("en", { style: "currency", currency: current.currency, maximumFractionDigits: 0 }).format(current.shippingRates[0].freeOverAmount / 100) : "—"} · Shipping to {current.name}</>}</div>
        <Header
          code={code}
          name={site.storeName}
          items={site.headerMenu.map((m) => ({ label: m.label, href: menuHref(code, m.url), children: m.children?.map((c) => ({ label: c.label, href: menuHref(code, c.url) })) }))}
          markets={markets.map((m) => ({ id: m.id, code: m.code, name: m.name, currency: m.currency, on: m.id === current.id }))}
          current={{ code: current.code, currency: current.currency }}
        />
        <main className="sf-main">{children}</main>
        <footer className="sf-foot">
          <div className="foot-grid">
            <div className="foot-about">
              <img src="/theme/logo-white.png" alt={site.storeName} width={160} />
              <p>{site.tagline}</p>
              <p><a href={brand.instagram} target="_blank" rel="noreferrer noopener">Instagram</a> · <a href={brand.whatsapp} target="_blank" rel="noreferrer noopener">WhatsApp</a></p>
            </div>
            <div>
              <h4>Quick Links</h4>
              <ul className="sf-footnav">
                {site.footerMenu.map((m, i) => <li key={`m${i}`}><Link href={menuHref(code, m.url)}>{m.label}</Link></li>)}
                <li><Link href={`/${code}/track-order`}>Track your order</Link></li>
                {policies.map((p) => <li key={p.key}><Link href={`/${code}/policies/${p.key}`}>{p.title}</Link></li>)}
              </ul>
            </div>
            <div>
              <h4>Address</h4>
              {brand.addresses.map((a, i) => <p key={i} className="addr">{a.lines.join(" ")}</p>)}
              <p className="addr"><a href={`mailto:${brand.email}`}>{brand.email}</a></p>
              <p className="addr"><a href={brand.phoneHref}>{brand.phone}</a></p>
            </div>
          </div>
          <div className="foot-base">
            <div>{brand.copyright}</div>
            <div>Copyright © {new Date().getFullYear()} {site.storeName}. All rights reserved. · <CookieSettingsLink /> · Secure payments by Stripe · {current.taxInclusive ? "Prices include tax" : "Tax added at checkout"}</div>
          </div>
        </footer>
      </div>
      {site.popup?.enabled && site.popup.text && <SitePopup title={site.popup.title} text={site.popup.text} />}
      </WishlistProvider>
    </CartProvider>
  );
}
