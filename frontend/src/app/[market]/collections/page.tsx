import type { Metadata } from "next";
import Link from "next/link";
import { getCollections, getMarkets, getSite } from "@/lib/store";
import { marketAlternates, siteOrigin } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ market: string }> }): Promise<Metadata> {
  const { market } = await params;
  const [site, markets] = await Promise.all([getSite(), getMarkets()]);
  return { title: `Collections | ${site.storeName}`, description: `Shop ${site.storeName} by collection.`, alternates: marketAlternates(siteOrigin(site.publicUrl), market, markets, "/collections") };
}

export default async function Collections({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  const list = await getCollections();
  return (
    <article className="sf-page">
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / Collections</p>
      <h1>Collections</h1>
      {list.length ? <div className="collrow">{list.map((c) => <Link key={c.handle} href={`/${market}/collections/${c.handle}`} className="collchip">{c.title}</Link>)}</div> : <p className="muted">No collections yet.</p>}
    </article>
  );
}
