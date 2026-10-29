import type { Metadata } from "next";
import Link from "next/link";
import { getCollections, getSite } from "@/lib/store";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return { title: `Collections | ${site.storeName}` };
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
