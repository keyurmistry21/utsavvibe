import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarkets, getProduct } from "@/lib/store";
import { AddToCart } from "@/components/store/AddToCart";
import { Gallery } from "@/components/store/Gallery";

type Props = { params: Promise<{ market: string; handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { market, handle } = await params;
  const p = await getProduct(market.toUpperCase(), handle);
  return p ? { title: p.seoTitle || `${p.title} | UtsavVibe`, description: p.seoDescription || p.description.slice(0, 160) } : {};
}

export default async function ProductPage({ params }: Props) {
  const { market, handle } = await params;
  const [p, markets] = await Promise.all([getProduct(market.toUpperCase(), handle), getMarkets()]);
  const current = markets.find((m) => m.code.toLowerCase() === market.toLowerCase());
  if (!p || !current) notFound();

  return (
    <>
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / {p.title}</p>
      <div className="pdp">
        <Gallery images={p.images} title={p.title} />
        <div>
          <h1>{p.title}</h1>
          <AddToCart product={p} market={market.toLowerCase()} />
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
    </>
  );
}
