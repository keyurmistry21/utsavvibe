import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCollections, getMarkets, getProducts, getSite } from "@/lib/store";
import { marketAlternates, siteOrigin } from "@/lib/seo";
import { JsonLd } from "@/components/store/JsonLd";
import { money } from "@/lib/api";
import { ProductGrid } from "@/components/store/ProductGrid";

export async function generateMetadata({ params }: { params: Promise<{ market: string }> }): Promise<Metadata> {
  const { market } = await params;
  const [site, markets] = await Promise.all([getSite(), getMarkets()]);
  const title = site.metaTitle || `${site.storeName} — Festive & devotional gifts (${market.toUpperCase()})`;
  const description = site.metaDescription || site.tagline;
  const origin = siteOrigin(site.publicUrl);
  return {
    title,
    description,
    alternates: marketAlternates(origin, market, markets, ""),
    openGraph: { title, description, siteName: site.storeName, url: `${origin}/${market.toLowerCase()}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function MarketHome({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  const [products, markets, collections, site] = await Promise.all([getProducts(market.toUpperCase()), getMarkets(), getCollections(), getSite()]);
  const current = markets.find((m) => m.code.toLowerCase() === market.toLowerCase());
  if (!products || !current) notFound();
  const free = current.shippingRates[0]?.freeOverAmount;

  const origin = siteOrigin(site.publicUrl);
  return (
    <>
      <JsonLd data={[
        { "@context": "https://schema.org", "@type": "Organization", name: site.storeName, url: origin, description: site.tagline },
        { "@context": "https://schema.org", "@type": "WebSite", name: site.storeName, url: `${origin}/${market.toLowerCase()}`, inLanguage: "en" },
      ]} />
      <section className="hero">
        <div>
          <p className="eyebrow">Festive season · {current.name}</p>
          <h1>Celebrate every ritual,<br />beautifully.</h1>
          <p className="sub">Handpicked idols, diyas, rakhis and pooja essentials, priced in {current.currency} and delivered to your door.</p>
          <a href="#shop" className="btn">Shop the collection</a>
        </div>
        <div className="hero-art" aria-hidden="true"><i /><i /><i /></div>
      </section>

      <section className="trust">
        <div><b>{free != null ? `Free shipping over ${money(free, current.currency)}` : "Tracked delivery"}</b><span>Tracked to your door</span></div>
        <div><b>{current.taxInclusive ? "Tax included" : "Clear pricing"}</b><span>{current.taxInclusive ? "No surprises at checkout" : "Tax shown before you pay"}</span></div>
        <div><b>Secure checkout</b><span>Powered by Stripe</span></div>
      </section>

      {!!collections.length && (
        <section>
          <h2 className="sec">Shop by collection</h2>
          <div className="collrow">{collections.map((c) => <Link key={c.handle} href={`/${market}/collections/${c.handle}`} className="collchip">{c.title}</Link>)}</div>
        </section>
      )}

      <section id="shop">
        <h2 className="sec">Shop all</h2>
        {products.length ? (
          <ProductGrid market={market} products={products} />
        ) : (
          <div className="sf-empty">
            <h3>Nothing here yet</h3>
            <p>No products are available in {current.name} right now. Check back soon.</p>
          </div>
        )}
      </section>
    </>
  );
}
