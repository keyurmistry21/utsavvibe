import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarkets, getProduct, getSite } from "@/lib/store";
import { absUrl, marketAlternates, priceStr, siteOrigin } from "@/lib/seo";
import { htmlToText } from "@/lib/text";
import { JsonLd } from "@/components/store/JsonLd";
import { AddToCart } from "@/components/store/AddToCart";
import { Gallery } from "@/components/store/Gallery";
import { PdpImageProvider } from "@/components/store/PdpImage";
import { Reviews, type ReviewData } from "@/components/store/Reviews";

type Props = { params: Promise<{ market: string; handle: string }>; searchParams?: Promise<{ variant?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { market, handle } = await params;
  const [p, markets, site] = await Promise.all([getProduct(market.toUpperCase(), handle), getMarkets(), getSite()]);
  if (!p) return {};
  // hreflang only between markets that actually sell this product
  const sold = (await Promise.all(markets.map(async (m) => ((await getProduct(m.code, handle)) ? m : null)))).filter((m) => !!m);
  const origin = siteOrigin(site.publicUrl);
  const title = p.seoTitle || `${p.title} | ${site.storeName}`;
  const description = p.seoDescription || htmlToText(p.descriptionHtml || p.description).slice(0, 160);
  return {
    title,
    description,
    alternates: marketAlternates(origin, market, sold, `/products/${handle}`),
    openGraph: { type: "website", title, description, siteName: site.storeName, url: `${origin}/${market.toLowerCase()}/products/${handle}`, images: p.images.slice(0, 4).map((i) => ({ url: i.url, alt: i.alt || p.title })) },
    twitter: { card: "summary_large_image", title, description, images: p.images[0] ? [p.images[0].url] : undefined },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { market, handle } = await params;
  const { variant } = (await searchParams) ?? {};
  const [p, markets, site] = await Promise.all([getProduct(market.toUpperCase(), handle), getMarkets(), getSite()]);
  const current = markets.find((m) => m.code.toLowerCase() === market.toLowerCase());
  if (!p || !current) notFound();
  const origin = siteOrigin(site.publicUrl);
  const pageUrl = `${origin}/${market.toLowerCase()}/products/${handle}`;
  const offers = p.variants.filter((v) => v.price != null).map((v) => ({
    "@type": "Offer",
    url: p.variants.length > 1 ? `${pageUrl}?variant=${v.id}` : pageUrl,
    price: priceStr(v.price!),
    priceCurrency: p.currency,
    availability: `https://schema.org/${v.inStock ? "InStock" : "OutOfStock"}`,
    itemCondition: "https://schema.org/NewCondition",
    ...(p.variants.length > 1 ? { name: v.title } : {}),
    ...(v.sku ? { sku: v.sku } : {}),
    ...(v.barcode ? { gtin: v.barcode } : {}),
  }));
  const first = p.variants[0];
  // approved reviews (fresh: a moderator can hide one at any time)
  const rv: ReviewData | null = await fetch(`${process.env.BACKEND_URL ?? "http://localhost:4000"}/api/store/reviews/${encodeURIComponent(handle)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  return (
    <>
      <JsonLd data={[
        {
          "@context": "https://schema.org",
          "@type": "Product",
          name: p.title,
          description: htmlToText(p.descriptionHtml || p.description).slice(0, 5000) || p.title,
          url: pageUrl,
          ...(p.images.length ? { image: p.images.map((i) => absUrl(origin, i.url)) } : {}),
          brand: { "@type": "Brand", name: site.storeName },
          ...(first?.sku ? { sku: first.sku } : {}),
          ...(first?.barcode ? { gtin: first.barcode } : {}),
          offers,
          ...(rv?.count && rv.average ? { aggregateRating: { "@type": "AggregateRating", ratingValue: rv.average, reviewCount: rv.count } } : {}),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Shop", item: `${origin}/${market.toLowerCase()}` },
            { "@type": "ListItem", position: 2, name: p.title, item: pageUrl },
          ],
        },
      ]} />
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / {p.title}</p>
      <PdpImageProvider initial={p.variants.find((v) => v.id === variant)?.imageUrl}>
      <div className="pdp">
        <Gallery images={p.images} title={p.title} />
        <div>
          <h1>{p.title}</h1>
          {rv?.count ? <a href="#reviews" className="ratingline" aria-label={`${rv.average} out of 5 stars, ${rv.count} reviews`}><span className="stars" aria-hidden="true">{"★★★★★".slice(0, Math.round(rv.average ?? 0))}<i>{"★★★★★".slice(Math.round(rv.average ?? 0))}</i></span> {rv.average} ({rv.count})</a> : null}
          <AddToCart product={p} market={market.toLowerCase()} highlight={variant} />
          {/* sanitized by the API when the product is saved */}
          <div className="desc" dangerouslySetInnerHTML={{ __html: p.descriptionHtml }} />
          <ul className="notes">
            <li>{current.taxInclusive ? "Price includes tax" : "Tax calculated at checkout"}</li>
            {current.shippingRates[0] && <li>Delivery: {current.shippingRates[0].name}{current.shippingRates[0].freeOverAmount != null ? " (free over threshold)" : ""}</li>}
            {p.regions.length > 0 && <li>Available in: {p.regions.map((c) => current.regions.find((r) => r.code === c)?.name ?? c).join(", ")}</li>}
            <li>Secure payment with Stripe</li>
          </ul>
          <div className="tags">{p.tags.filter((t) => t !== "demo").map((t) => <span key={t} className="chip">{t}</span>)}</div>
        </div>
      </div>
      </PdpImageProvider>
      <Reviews handle={handle} data={rv} />
    </>
  );
}
