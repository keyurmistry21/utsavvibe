import type { Metadata } from "next";
import Link from "next/link";
import { getMarkets, getPosts, getSite } from "@/lib/store";
import { siteOrigin } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ market: string }> }): Promise<Metadata> {
  const { market } = await params;
  const site = await getSite();
  return { title: `Blog | ${site.storeName}`, description: `News, guides and festive ideas from ${site.storeName}.`, alternates: { canonical: `${siteOrigin(site.publicUrl)}/${(await getMarkets())[0]?.code.toLowerCase() ?? market}/blog` } };
}

export default async function Blog({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  const posts = await getPosts();
  return (
    <article className="sf-page">
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / Blog</p>
      <h1>Blog</h1>
      {posts.length ? (
        <div className="postlist">
          {posts.map((p) => (
            <Link key={p.handle} href={`/${market}/blog/${p.handle}`} className="postcard">
              {p.coverImage && <img src={p.coverImage} alt={p.title} width={400} height={300} loading="lazy" />}
              <div>
                <h2>{p.title}</h2>
                <span className="muted">{new Date(p.publishedAt).toLocaleDateString("en", { dateStyle: "long" })}{p.author ? ` · ${p.author}` : ""}</span>
                <p>{p.excerpt}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : <p className="muted">No posts yet. Check back soon.</p>}
    </article>
  );
}
