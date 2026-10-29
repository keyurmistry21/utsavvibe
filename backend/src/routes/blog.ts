import { Router, raw } from "express";
import { randomUUID } from "node:crypto";
import { processImage } from "../images.js";
import { imageUrls, saveFile } from "../storage.js";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { htmlToText, normalizeHandle, sanitizeDescription } from "../html.js";

// Admin side of the blog. One blog ("News") with posts; drafts, publish, schedule by date.
export const blogRouter = Router();

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

const imageUrl = z.string().trim().max(500).refine((u) => !u || /^\/uploads\/[\w.-]+$/.test(u) || /^https:\/\/[^\s]+$/.test(u), "Use an https:// image address").default("");
const input = z.object({
  title: z.string().trim().min(1, "title is required").max(200),
  handle: z.string().trim().max(100).optional(),
  excerpt: z.string().trim().max(500).default(""),
  content: z.string().max(300_000).default(""),
  author: z.string().trim().max(100).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  coverImage: imageUrl,
  published: z.boolean().default(false),
  publishedAt: z.string().datetime().nullable().optional(), // ISO; a future date schedules the post
  seoTitle: z.string().trim().max(200).default(""),
  seoDescription: z.string().trim().max(500).default(""),
});

async function freeHandle(wanted: string, title: string, exceptId?: string) {
  const base = normalizeHandle(wanted || title) || "post";
  for (let n = 1; n < 200; n++) {
    const h = n === 1 ? base : `${base}-${n}`;
    const hit = await prisma.blogPost.findUnique({ where: { handle: h }, select: { id: true } });
    if (!hit || hit.id === exceptId) return h;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const shape = (p: any) => ({ ...p, tags: parseJson<string[]>(p.tags, []) });
const data = (d: z.infer<typeof input>, cur?: { published: boolean; publishedAt: Date | null }) => ({
  title: d.title, excerpt: d.excerpt, content: sanitizeDescription(d.content), author: d.author, tags: JSON.stringify(d.tags), coverImage: d.coverImage,
  published: d.published, seoTitle: d.seoTitle, seoDescription: d.seoDescription,
  // publishing without a date uses now; unpublishing keeps the old date so republishing doesn't jump
  publishedAt: d.publishedAt ? new Date(d.publishedAt) : d.published ? (cur?.publishedAt ?? new Date()) : (cur?.publishedAt ?? null),
});

// Cover/inline images for posts: same pipeline as product images (re-encoded to WebP, EXIF stripped), raw body.
blogRouter.post("/images", raw({ type: () => true, limit: "12mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad("empty upload");
  const out = await processImage(req.body);
  const id = `blog-${randomUUID()}`;
  await saveFile(`${id}.webp`, out.full);
  res.status(201).json({ url: imageUrls(id).url, width: out.width, height: out.height });
});

blogRouter.get("/posts", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const rows = await prisma.blogPost.findMany({ where: q ? { OR: [{ title: { contains: q } }, { author: { contains: q } }, { tags: { contains: q } }] } : {}, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, handle: true, author: true, published: true, publishedAt: true, updatedAt: true, excerpt: true, content: true } });
  res.json(rows.map(({ content, ...p }) => ({ ...p, excerpt: p.excerpt || htmlToText(content).slice(0, 140) })));
});

blogRouter.get("/posts/:id", async (req, res) => {
  const p = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
  if (!p) return void res.status(404).json({ error: "post not found" });
  res.json(shape(p));
});

blogRouter.post("/posts", async (req, res) => {
  const d = input.parse(req.body);
  if (d.handle && (await prisma.blogPost.findUnique({ where: { handle: normalizeHandle(d.handle) } }))) throw bad(`The URL handle "${normalizeHandle(d.handle)}" is already used by another post`, 409);
  res.status(201).json(shape(await prisma.blogPost.create({ data: { ...data(d), handle: await freeHandle(d.handle ?? "", d.title) } })));
});

blogRouter.put("/posts/:id", async (req, res) => {
  const d = input.parse(req.body);
  const cur = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
  if (!cur) return void res.status(404).json({ error: "post not found" });
  const handle = normalizeHandle(d.handle || d.title) || cur.handle;
  const clash = await prisma.blogPost.findUnique({ where: { handle } });
  if (clash && clash.id !== cur.id) throw bad(`The URL handle "${handle}" is already used by another post`, 409);
  res.json(shape(await prisma.blogPost.update({ where: { id: cur.id }, data: { ...data(d, cur), handle } })));
});

blogRouter.delete("/posts/:id", async (req, res) => {
  await prisma.blogPost.deleteMany({ where: { id: req.params.id } });
  res.json({ ok: true });
});

blogRouter.post("/posts/bulk", async (req, res) => {
  const d = z.object({ ids: z.array(z.string()).min(1).max(200), action: z.enum(["publish", "unpublish", "delete"]) }).parse(req.body);
  if (d.action === "delete") await prisma.blogPost.deleteMany({ where: { id: { in: d.ids } } });
  else if (d.action === "unpublish") await prisma.blogPost.updateMany({ where: { id: { in: d.ids } }, data: { published: false } });
  else for (const id of d.ids) { const p = await prisma.blogPost.findUnique({ where: { id } }); if (p) await prisma.blogPost.update({ where: { id }, data: { published: true, publishedAt: p.publishedAt ?? new Date() } }); }
  res.json({ ok: true });
});

// Storefront: only published posts whose date has arrived.
const live = () => ({ published: true, publishedAt: { lte: new Date() } });
export async function publicPosts() {
  const rows = await prisma.blogPost.findMany({ where: live(), orderBy: { publishedAt: "desc" }, take: 100, select: { handle: true, title: true, excerpt: true, content: true, author: true, coverImage: true, publishedAt: true, tags: true } });
  return rows.map(({ content, tags, ...p }) => ({ ...p, tags: parseJson<string[]>(tags, []), excerpt: p.excerpt || htmlToText(content).slice(0, 180) }));
}
export async function publicPost(handle: string) {
  const p = await prisma.blogPost.findFirst({ where: { handle, ...live() } });
  return p ? { handle: p.handle, title: p.title, excerpt: p.excerpt, contentHtml: p.content, author: p.author, coverImage: p.coverImage, publishedAt: p.publishedAt, tags: parseJson<string[]>(p.tags, []), seoTitle: p.seoTitle, seoDescription: p.seoDescription } : null;
}
