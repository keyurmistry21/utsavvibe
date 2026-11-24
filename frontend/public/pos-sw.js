// Offline shell for the in-store till (/admin/sell). Pages and static assets are cached as they are used online, so the screen
// opens with no connection. API calls are never cached: sales queue inside the page and sync later (see lib/offlinePos.ts).
const CACHE = "uv-pos-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const isAsset = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/uploads/");
  const isTill = req.mode === "navigate" && url.pathname.startsWith("/admin/sell");
  if (!isAsset && !isTill) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isTill) {
      try { const res = await fetch(req); if (res.ok) cache.put("/admin/sell", res.clone()); return res; }
      catch { return (await cache.match("/admin/sell")) ?? (await cache.match(req)) ?? Response.error(); }
    }
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit ?? net;
  })());
});
