import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCollection, getSite } from "@/lib/store";
import { htmlToText } from "@/lib/text";
import { ProductGrid } from "@/components/store/ProductGrid";

type Props = { params: Promise<{ market: string; handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { market, handle } = await params;
  const [c, site] = await Promise.all([getCollection(market.toUpperCase(), handle), getSite()]);
  if (!c) return {};
  return { title: c.seoTitle || `${c.title} | ${site.storeName}`, description: c.seoDescription || htmlToText(c.descriptionHtml).slice(0, 160) || undefined };
}

export default async function CollectionPage({ params }: Props) {
  const { market, handle } = await params;
  const c = await getCollection(market.toUpperCase(), handle);
  if (!c) notFound();
  return (
    <>
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / {c.title}</p>
      <h1 className="sec">{c.title}</h1>
      {/* sanitized by the API when the collection is saved */}
      {c.descriptionHtml && <div className="desc" style={{ marginBottom: 20 }} dangerouslySetInnerHTML={{ __html: c.descriptionHtml }} />}
      {c.products.length ? <ProductGrid market={market} products={c.products} /> : <div className="sf-empty"><h3>Nothing here yet</h3><p>No products in this collection are available right now.</p></div>}
    </>
  );
}
