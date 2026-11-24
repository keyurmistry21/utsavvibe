import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCollection, getMarkets, getSite } from "@/lib/store";
import { marketAlternates, siteOrigin } from "@/lib/seo";
import { JsonLd } from "@/components/store/JsonLd";
import { htmlToText } from "@/lib/text";
import { ProductGrid } from "@/components/store/ProductGrid";

type Props = { params: Promise<{ market: string; handle: string }>; searchParams?: Promise<{ tag?: string; size?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { market, handle } = await params;
  const [c, site, markets] = await Promise.all([getCollection(market.toUpperCase(), handle), getSite(), getMarkets()]);
  if (!c) return {};
  const origin = siteOrigin(site.publicUrl);
  const title = c.seoTitle || `${c.title} | ${site.storeName}`;
  const description = c.seoDescription || htmlToText(c.descriptionHtml).slice(0, 160) || undefined;
  const img = c.products.find((p) => p.images[0])?.images[0];
  return {
    title,
    description,
    alternates: marketAlternates(origin, market, markets, `/collections/${handle}`),
    openGraph: { type: "website", title, description, siteName: site.storeName, url: `${origin}/${market.toLowerCase()}/collections/${handle}`, ...(img ? { images: [{ url: img.url, alt: img.alt || c.title }] } : {}) },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const { market, handle } = await params;
  const { tag, size } = (await searchParams) ?? {};
  const [c, site] = await Promise.all([getCollection(market.toUpperCase(), handle), getSite()]);
  if (!c) notFound();
  // ?tag=couple+rakhi and ?size=12+inch narrow the list (links from the menu)
  const lc = (x: string) => x.trim().toLowerCase();
  const shown = c.products.filter((p) => (!tag || p.tags.map(lc).includes(lc(tag))) && (!size || p.variants.some((v) => Object.values(v.options).some((o) => lc(String(o)) === lc(size)) || lc(v.title) === lc(size))));
  const filtered = !!(tag || size);
  const origin = siteOrigin(site.publicUrl);
  const url = `${origin}/${market.toLowerCase()}/collections/${handle}`;
  return (
    <>
      <JsonLd data={[
        { "@context": "https://schema.org", "@type": "CollectionPage", name: c.title, url, mainEntity: { "@type": "ItemList", itemListElement: c.products.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${origin}/${market.toLowerCase()}/products/${p.handle}`, name: p.title })) } },
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Shop", item: `${origin}/${market.toLowerCase()}` }, { "@type": "ListItem", position: 2, name: c.title, item: url }] },
      ]} />
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / {c.title}</p>
      <h1 className="sec">{c.title}</h1>
      {/* sanitized by the API when the collection is saved */}
      {c.descriptionHtml && <div className="desc" style={{ marginBottom: 20 }} dangerouslySetInnerHTML={{ __html: c.descriptionHtml }} />}
      {filtered && <p className="muted" style={{ marginBottom: 16 }}>Showing: <b>{tag || size}</b> · <Link href={`/${market}/collections/${handle}`}>Show all</Link></p>}
      {shown.length ? <ProductGrid market={market} products={shown} /> : <div className="sf-empty"><h3>Nothing here yet</h3><p>{filtered ? "Nothing matches that filter right now." : "No products in this collection are available right now."}</p></div>}
    </>
  );
}
