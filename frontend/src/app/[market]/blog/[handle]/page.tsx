import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost, getSite } from "@/lib/store";

type Props = { params: Promise<{ market: string; handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const [p, site] = await Promise.all([getPost(handle), getSite()]);
  if (!p) return {};
  return { title: p.seoTitle || `${p.title} | ${site.storeName}`, description: p.seoDescription || p.excerpt || undefined, ...(p.coverImage ? { openGraph: { images: [p.coverImage] } } : {}) };
}

export default async function BlogPostPage({ params }: Props) {
  const { market, handle } = await params;
  const p = await getPost(handle);
  if (!p) notFound();
  return (
    <article className="sf-page">
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / <Link href={`/${market}/blog`}>Blog</Link> / {p.title}</p>
      <h1>{p.title}</h1>
      <p className="muted">{new Date(p.publishedAt).toLocaleDateString("en", { dateStyle: "long" })}{p.author ? ` · ${p.author}` : ""}</p>
      {p.coverImage && <img className="postcover" src={p.coverImage} alt="" />}
      {/* sanitized by the API when the post is saved */}
      <div className="desc" dangerouslySetInnerHTML={{ __html: p.contentHtml }} />
      {!!p.tags.length && <p className="muted">{p.tags.map((t) => `#${t}`).join("  ")}</p>}
    </article>
  );
}
