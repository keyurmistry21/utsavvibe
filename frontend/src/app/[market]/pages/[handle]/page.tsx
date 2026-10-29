import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarkets, getPage, getSite } from "@/lib/store";
import { siteOrigin } from "@/lib/seo";
import { htmlToText } from "@/lib/text";

type Props = { params: Promise<{ market: string; handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const [page, site, markets] = await Promise.all([getPage(handle), getSite(), getMarkets()]);
  if (!page) return {};
  const title = page.seoTitle || `${page.title} | ${site.storeName}`;
  const description = page.seoDescription || htmlToText(page.content).slice(0, 160);
  const canonical = `${siteOrigin(site.publicUrl)}/${(markets[0]?.code ?? "uk").toLowerCase()}/pages/${handle}`; // same text in every market
  return { title, description, alternates: { canonical }, openGraph: { type: "website", title, description, siteName: site.storeName, url: canonical }, twitter: { card: "summary", title, description } };
}

export default async function CmsPage({ params }: Props) {
  const { market, handle } = await params;
  const page = await getPage(handle);
  if (!page) notFound();
  return (
    <article className="sf-page">
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / {page.title}</p>
      <h1>{page.title}</h1>
      {/* sanitized by the API when the page is saved */}
      <div className="desc" dangerouslySetInnerHTML={{ __html: page.content }} />
    </article>
  );
}
