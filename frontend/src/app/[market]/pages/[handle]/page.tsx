import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPage, getSite } from "@/lib/store";
import { htmlToText } from "@/lib/text";

type Props = { params: Promise<{ market: string; handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const [page, site] = await Promise.all([getPage(handle), getSite()]);
  if (!page) return {};
  return { title: page.seoTitle || `${page.title} | ${site.storeName}`, description: page.seoDescription || htmlToText(page.content).slice(0, 160) };
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
