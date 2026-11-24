import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCollections, getMarkets, getProducts, getSite } from "@/lib/store";
import { marketAlternates, siteOrigin } from "@/lib/seo";
import { JsonLd } from "@/components/store/JsonLd";
import { money } from "@/lib/api";
import { ProductGrid } from "@/components/store/ProductGrid";
import { Celebrate, Faq, Family, Hero, PreBook, Showcases, Testimonials, Why } from "@/components/store/HomeSections";

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
  const ig: { id: string; permalink: string; image: string; caption: string }[] = await fetch(`${process.env.BACKEND_URL ?? "http://localhost:4000"}/api/store/instagram`, { next: { revalidate: 300 } }).then((r) => (r.ok ? r.json() : { posts: [] })).then((d) => d.posts ?? []).catch(() => []);
  return (
    <>
      <JsonLd data={[
        { "@context": "https://schema.org", "@type": "Organization", name: site.storeName, url: origin, description: site.tagline },
        { "@context": "https://schema.org", "@type": "WebSite", name: site.storeName, url: `${origin}/${market.toLowerCase()}`, inLanguage: "en" },
      ]} />
      <Hero market={market} />
      <PreBook market={market} />
      <Why />
      <Showcases market={market} />

      <section id="shop" className="th-sec th-shop">
        <h2 className="th-title"><span className="acc">Shop </span><span>All</span></h2>
        {!!collections.length && <div className="collrow">{collections.map((c) => <Link key={c.handle} href={`/${market}/collections/${c.handle}`} className="collchip">{c.title}</Link>)}</div>}
        {products.length ? (
          <ProductGrid market={market} products={products} />
        ) : (
          <div className="sf-empty">
            <h3>Nothing here yet</h3>
            <p>No products are available in {current.name} right now. Check back soon.</p>
          </div>
        )}
        {free != null && <p className="th-lead">Free shipping on orders over {money(free, current.currency)}</p>}
      </section>

      <Family ig={ig} />
      <Celebrate market={market} />
      <Testimonials />
      <Faq />
    </>
  );
}
