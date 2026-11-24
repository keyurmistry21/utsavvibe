// Latest Instagram posts for the storefront, through the Instagram API with Instagram Login.
// Set INSTAGRAM_ACCESS_TOKEN (a long-lived token for a Business/Creator account; it lasts 60 days and can be refreshed) in backend/.env.
// Not tested against the live API from this repo. Without the token the storefront simply shows nothing.
export type IgPost = { id: string; permalink: string; image: string; caption: string };
let cache: { at: number; posts: IgPost[] } = { at: 0, posts: [] };

export const instagramConfigured = () => !!process.env.INSTAGRAM_ACCESS_TOKEN;

export async function latestPosts(limit = 9): Promise<IgPost[]> {
  if (!instagramConfigured()) return [];
  if (Date.now() - cache.at < 15 * 60_000) return cache.posts.slice(0, limit);
  try {
    const url = new URL("https://graph.instagram.com/me/media");
    url.searchParams.set("fields", "id,caption,media_type,media_url,thumbnail_url,permalink");
    url.searchParams.set("limit", "18");
    url.searchParams.set("access_token", process.env.INSTAGRAM_ACCESS_TOKEN!);
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`Instagram ${res.status}`);
    const data = (await res.json()) as { data?: { id: string; caption?: string; media_type: string; media_url?: string; thumbnail_url?: string; permalink: string }[] };
    const posts = (data.data ?? [])
      .map((m) => ({ id: m.id, permalink: m.permalink, image: m.media_type === "VIDEO" ? m.thumbnail_url ?? "" : m.media_url ?? "", caption: (m.caption ?? "").slice(0, 140) }))
      .filter((p) => /^https:\/\//.test(p.image) && /^https:\/\/(www\.)?instagram\.com\//.test(p.permalink));
    cache = { at: Date.now(), posts };
  } catch (e) {
    console.error("instagram feed failed:", (e as Error).message);
    cache = { ...cache, at: Date.now() - 10 * 60_000 }; // keep the old posts, retry in ~5 min
  }
  return cache.posts.slice(0, limit);
}
