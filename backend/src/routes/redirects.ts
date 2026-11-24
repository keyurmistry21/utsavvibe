import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit } from "../audit.js";

// Admin: 301 redirects from old URLs (for example the previous Shopify store) so search ranking carries over.
export const redirectsRouter = Router();

// "/old-path" only (no query or host); the target is a path on this site or an https address.
export const cleanFrom = (v: string) => {
  let p = v.trim();
  try { if (/^https?:\/\//i.test(p)) p = new URL(p).pathname; } catch { /* keep */ }
  p = p.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return p.startsWith("/") ? p.toLowerCase() : `/${p.toLowerCase()}`;
};
const cleanTo = (v: string) => v.trim();
const okTo = (v: string) => (v.startsWith("/") && !v.startsWith("//")) || /^https:\/\/[^\s]+$/i.test(v);

const row = z.object({ from: z.string().trim().min(1).max(300), to: z.string().trim().min(1).max(500) });

redirectsRouter.get("/", async (_req, res) => res.json(await prisma.redirect.findMany({ orderBy: { createdAt: "desc" }, take: 2000 })));

redirectsRouter.post("/", async (req, res) => {
  const d = row.parse(req.body);
  const fromPath = cleanFrom(d.from), toPath = cleanTo(d.to);
  if (fromPath === "/" || fromPath.startsWith("/admin") || fromPath.startsWith("/api")) return void res.status(400).json({ error: "That path can't be redirected" });
  if (!okTo(toPath)) return void res.status(400).json({ error: "Redirect to a path on this site (starting with /) or an https address" });
  if (fromPath === toPath.toLowerCase()) return void res.status(400).json({ error: "The old and new address are the same" });
  const r = await prisma.redirect.upsert({ where: { fromPath }, create: { fromPath, toPath }, update: { toPath } });
  await audit(req, "redirect_saved", `${fromPath} -> ${toPath}`);
  res.status(201).json(r);
});

// Paste or upload rows (Shopify's "URL redirects" export has "Redirect from" and "Redirect to" columns).
redirectsRouter.post("/bulk", async (req, res) => {
  const d = z.object({ rows: z.array(row).min(1).max(2000) }).parse(req.body);
  let saved = 0; const skipped: string[] = [];
  for (const r of d.rows) {
    const fromPath = cleanFrom(r.from), toPath = cleanTo(r.to);
    if (fromPath === "/" || fromPath.startsWith("/admin") || fromPath.startsWith("/api") || !okTo(toPath) || fromPath === toPath.toLowerCase()) { skipped.push(r.from); continue; }
    await prisma.redirect.upsert({ where: { fromPath }, create: { fromPath, toPath }, update: { toPath } });
    saved++;
  }
  await audit(req, "redirects_imported", `${saved} saved, ${skipped.length} skipped`);
  res.json({ saved, skipped: skipped.slice(0, 20), skippedCount: skipped.length });
});

redirectsRouter.delete("/:id", async (req, res) => {
  const r = await prisma.redirect.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!r) return void res.status(404).json({ error: "not found" });
  await audit(req, "redirect_deleted", r.fromPath);
  res.json({ ok: true });
});
