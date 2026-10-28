import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPolicy, getSite } from "@/lib/store";

type Props = { params: Promise<{ market: string; key: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  const [p, site] = await Promise.all([getPolicy(key), getSite()]);
  return p ? { title: `${p.title} | ${site.storeName}` } : {};
}

export default async function PolicyPage({ params }: Props) {
  const { market, key } = await params;
  const p = await getPolicy(key);
  if (!p) notFound();
  return (
    <article className="sf-page">
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / {p.title}</p>
      <h1>{p.title}</h1>
      {/* sanitized by the API when the policy is saved */}
      <div className="desc" dangerouslySetInnerHTML={{ __html: p.content }} />
    </article>
  );
}
