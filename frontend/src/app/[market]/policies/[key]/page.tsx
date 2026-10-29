import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarkets, getPolicy, getSite } from "@/lib/store";
import { htmlToText } from "@/lib/text";
import { siteOrigin } from "@/lib/seo";

type Props = { params: Promise<{ market: string; key: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  const [p, site, markets] = await Promise.all([getPolicy(key), getSite(), getMarkets()]);
  if (!p) return {};
  const title = `${p.title} | ${site.storeName}`;
  const description = htmlToText(p.content).slice(0, 160);
  const canonical = `${siteOrigin(site.publicUrl)}/${(markets[0]?.code ?? "uk").toLowerCase()}/policies/${key}`;
  return { title, description, alternates: { canonical }, openGraph: { type: "website", title, description, siteName: site.storeName, url: canonical } };
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
