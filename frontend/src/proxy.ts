import { NextResponse, type NextRequest } from "next/server";

const backend = process.env.BACKEND_URL ?? "http://localhost:4000";

// ---- 301 redirects from the old Shopify store (and any the admin adds under Online Store -> Redirects) ----
// Shopify URLs have no market in them (/products/<handle>); ours do (/uk/products/<handle>), so they are sent to the visitor's
// market (the uv_market cookie), else the first active market.
const POLICY_KEYS: Record<string, string> = { "refund-policy": "refund", "privacy-policy": "privacy", "terms-of-service": "terms", "shipping-policy": "shipping", "contact-information": "contact", "legal-notice": "legal" };
let cache: { at: number; map: Map<string, string>; firstMarket: string } = { at: 0, map: new Map(), firstMarket: "uk" };

async function tables() {
  if (Date.now() - cache.at < 60_000) return cache;
  try {
    const [r, m] = await Promise.all([
      fetch(`${backend}/api/store/redirects`, { cache: "no-store", signal: AbortSignal.timeout(1500) }).then((x) => (x.ok ? (x.json() as Promise<[string, string][]>) : [])),
      fetch(`${backend}/api/store/markets`, { cache: "no-store", signal: AbortSignal.timeout(1500) }).then((x) => (x.ok ? (x.json() as Promise<{ code: string }[]>) : [])),
    ]);
    cache = { at: Date.now(), map: new Map(r), firstMarket: (m[0]?.code ?? "UK").toLowerCase() };
  } catch {
    cache = { ...cache, at: Date.now() - 50_000 }; // API down: keep the old table and retry in ~10 s
  }
  return cache;
}

function shopifyTarget(path: string, market: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/collections\/[^/]+\/products\/([^/]+)$/))) return `/${market}/products/${m[1]}`;
  if ((m = path.match(/^\/products\/([^/]+)$/))) return `/${market}/products/${m[1]}`;
  if (path === "/collections" || path === "/collections/all") return `/${market}/collections`;
  if ((m = path.match(/^\/collections\/([^/]+)$/))) return `/${market}/collections/${m[1]}`;
  if ((m = path.match(/^\/pages\/([^/]+)$/))) return `/${market}/pages/${m[1]}`;
  if ((m = path.match(/^\/blogs\/[^/]+\/([^/]+)$/))) return `/${market}/blog/${m[1]}`;
  if (/^\/blogs\/[^/]+$/.test(path)) return `/${market}/blog`;
  if ((m = path.match(/^\/policies\/([^/]+)$/)) && POLICY_KEYS[m[1]]) return `/${market}/policies/${POLICY_KEYS[m[1]]}`;
  if (path === "/cart") return `/${market}/cart`;
  return null;
}

// Every API call carries `Authorization: Bearer <jwt>`. The token stays in an httpOnly cookie that page scripts can't read
// (so an XSS bug can't steal it); this proxy copies it into the header on the server side before forwarding to the API.
// Only staff calls (/api/admin, /api/auth) have a session: the storefront has no sign-in.
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (!path.startsWith("/api")) {
    if (req.method !== "GET" && req.method !== "HEAD") return NextResponse.next();
    const t = await tables();
    const key = (path.replace(/\/+$/, "") || "/").toLowerCase();
    const custom = t.map.get(key);
    const cookieMarket = req.cookies.get("uv_market")?.value?.toLowerCase();
    const target = custom ?? shopifyTarget(key, /^[a-z]{2}$/.test(cookieMarket ?? "") ? cookieMarket! : t.firstMarket);
    if (!target) return NextResponse.next();
    const url = /^https:\/\//i.test(target) ? new URL(target) : new URL(target, req.nextUrl.origin);
    if (url.origin === req.nextUrl.origin && url.pathname === path) return NextResponse.next(); // never loop
    if (url.origin === req.nextUrl.origin) url.search = req.nextUrl.search;
    return NextResponse.redirect(url, 301);
  }

  const cookie = path.startsWith("/api/admin") || path.startsWith("/api/auth") ? "uv_session" : null;
  const token = cookie ? req.cookies.get(cookie)?.value : null;
  if (!token || req.headers.has("authorization")) return NextResponse.next(); // no session, or the caller (e.g. an API key) brought its own
  const headers = new Headers(req.headers);
  headers.set("authorization", `Bearer ${token}`);
  return NextResponse.rewrite(new URL(path + req.nextUrl.search, backend), { request: { headers } });
}

// API calls, plus only the page paths that can be old Shopify URLs or admin-defined redirects (so normal pages skip the proxy).
export const config = { matcher: ["/api/:path*", "/((?!_next/|uploads/|admin(?:/|$)|favicon.ico|robots.txt|sitemap.xml|(?:uk|us|ca)(?:/|$)|p/|.*\\.[a-z0-9]+$).*)"] };
