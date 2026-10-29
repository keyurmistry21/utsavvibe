import type { Request, RequestHandler } from "express";

// Fixed-window limiter, in memory (use a shared store such as Redis if you ever run several API instances).
export function rateLimit(o: { windowMs: number; max: number; key?: (req: Request) => string; message?: string }): RequestHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, Math.max(o.windowMs, 60_000)).unref();
  return (req, res, next) => {
    const k = o.key?.(req) ?? req.ip ?? "?";
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset < now) hits.set(k, (h = { n: 0, reset: now + o.windowMs }));
    if (++h.n > o.max) {
      res.setHeader("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return void res.status(429).json({ error: o.message ?? "Too many requests. Please wait a moment and try again." });
    }
    next();
  };
}
