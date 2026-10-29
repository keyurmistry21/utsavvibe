import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarkets, getPost, getSite } from "@/lib/store";
import { absUrl, siteOrigin } from "@/lib/seo";
import { JsonLd } from "@/components/store/JsonLd";

type Props = { params: Promise<{ market: string; handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const [p, site, markets] = await Promise.all([getPost(handle), getSite(), getMarkets()]);
  if (!p) return {};
  const origin = siteOrigin(site.publicUrl);
  const title = p.seoTitle || `${p.title} | ${site.storeName}`;
  const description = p.seoDescription || p.excerpt || undefined;
  // same article in every market: one canonical (the default market)
  const canonical = `${origin}/${(markets[0]?.code ?? "uk").toLowerCase()}/blog/${handle}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: "article", title, description, siteName: site.storeName, url: canonical, publishedTime: p.publishedAt, authors: p.author ? [p.author] : undefined, ...(p.coverImage ? { images: [{ url: p.coverImage, alt: p.title }] } : {}) },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { market, handle } = await params;
  const [p, site] = await Promise.all([getPost(handle), getSite()]);
  if (!p) notFound();
  const origin = siteOrigin(site.publicUrl);
  return (
    <article className="sf-page">
      <JsonLd data={[
        {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: p.title,
          description: p.seoDescription || p.excerpt || undefined,
          datePublished: p.publishedAt,
          ...(p.coverImage ? { image: absUrl(origin, p.coverImage) } : {}),
          author: p.author ? { "@type": "Person", name: p.author } : { "@type": "Organization", name: site.storeName },
          publisher: { "@type": "Organization", name: site.storeName },
          mainEntityOfPage: `${origin}/${market.toLowerCase()}/blog/${handle}`,
        },
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Shop", item: `${origin}/${market.toLowerCase()}` }, { "@type": "ListItem", position: 2, name: "Blog", item: `${origin}/${market.toLowerCase()}/blog` }, { "@type": "ListItem", position: 3, name: p.title, item: `${origin}/${market.toLowerCase()}/blog/${handle}` }] },
      ]} />
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / <Link href={`/${market}/blog`}>Blog</Link> / {p.title}</p>
      <h1>{p.title}</h1>
      <p className="muted">{new Date(p.publishedAt).toLocaleDateString("en", { dateStyle: "long" })}{p.author ? ` · ${p.author}` : ""}</p>
      {p.coverImage && <img className="postcover" src={p.coverImage} alt={p.title} width={1200} height={630} fetchPriority="high" />}
      {/* sanitized by the API when the post is saved */}
      <div className="desc" dangerouslySetInnerHTML={{ __html: p.contentHtml }} />
      {!!p.tags.length && <p className="muted">{p.tags.map((t) => `#${t}`).join("  ")}</p>}
    </article>
  );
}
