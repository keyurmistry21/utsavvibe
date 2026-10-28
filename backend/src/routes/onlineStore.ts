import { Router } from "express";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { htmlToText, normalizeHandle, sanitizeDescription } from "../html.js";

// Admin side of the "Online store" section: content pages, navigation menus, store preferences.
export const onlineStoreRouter = Router();

const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 });

// ---- pages ----
const pageInput = z.object({
  title: z.string().trim().min(1, "title is required").max(200),
  handle: z.string().trim().max(100).optional(),
  content: z.string().max(200_000).default(""),
  visible: z.boolean().default(true),
  seoTitle: z.string().trim().max(200).default(""),
  seoDescription: z.string().trim().max(500).default(""),
});

async function pageHandle(wanted: string, title: string, exceptId?: string) {
  const base = normalizeHandle(wanted || title) || "page";
  for (let n = 1; n < 200; n++) {
    const h = n === 1 ? base : `${base}-${n}`;
    const hit = await prisma.page.findUnique({ where: { handle: h }, select: { id: true } });
    if (!hit || hit.id === exceptId) return h;
  }
  return `${base}-${Date.now().toString(36)}`;
}

onlineStoreRouter.get("/pages", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const pages = await prisma.page.findMany({
    where: q ? { OR: [{ title: { contains: q } }, { handle: { contains: q } }] } : {},
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, handle: true, visible: true, updatedAt: true, content: true },
  });
  res.json(pages.map(({ content, ...p }) => ({ ...p, excerpt: htmlToText(content).slice(0, 140) })));
});

onlineStoreRouter.get("/pages/:id", async (req, res) => {
  const p = await prisma.page.findUnique({ where: { id: req.params.id } });
  if (!p) return void res.status(404).json({ error: "page not found" });
  res.json(p);
});

onlineStoreRouter.post("/pages", async (req, res) => {
  const d = pageInput.parse(req.body);
  // an explicitly typed handle that is taken is an error; a generated one just gets -2
  if (d.handle && (await prisma.page.findUnique({ where: { handle: normalizeHandle(d.handle) } }))) throw bad(`The URL handle "${normalizeHandle(d.handle)}" is already used by another page`);
  const p = await prisma.page.create({ data: { ...d, handle: await pageHandle(d.handle ?? "", d.title), content: sanitizeDescription(d.content) } });
  res.status(201).json(p);
});

onlineStoreRouter.put("/pages/:id", async (req, res) => {
  const d = pageInput.parse(req.body);
  const cur = await prisma.page.findUnique({ where: { id: req.params.id } });
  if (!cur) return void res.status(404).json({ error: "page not found" });
  const handle = normalizeHandle(d.handle || d.title) || cur.handle;
  const clash = await prisma.page.findUnique({ where: { handle } });
  if (clash && clash.id !== cur.id) throw bad(`The URL handle "${handle}" is already used by another page`);
  res.json(await prisma.page.update({ where: { id: cur.id }, data: { ...d, handle, content: sanitizeDescription(d.content) } }));
});

onlineStoreRouter.delete("/pages/:id", async (req, res) => {
  await prisma.page.deleteMany({ where: { id: req.params.id } });
  res.json({ ok: true });
});

onlineStoreRouter.post("/pages/bulk", async (req, res) => {
  const d = z.object({ ids: z.array(z.string()).min(1).max(200), action: z.enum(["show", "hide", "delete"]) }).parse(req.body);
  if (d.action === "delete") await prisma.page.deleteMany({ where: { id: { in: d.ids } } });
  else await prisma.page.updateMany({ where: { id: { in: d.ids } }, data: { visible: d.action === "show" } });
  res.json({ ok: true });
});

// ---- navigation + preferences (one JSON blob in Setting) ----
// url: "/pages/about" style paths are relative to the market the customer is browsing; https:// links are used as typed.
const linkUrl = z.string().trim().max(500).refine((u) => /^\/[^\s]*$/.test(u) || /^https?:\/\/[^\s]+$/.test(u) || /^mailto:[^\s@]+@[^\s@]+$/.test(u), "Use a path like /pages/about, or a full https:// link");
const menu = z.array(z.object({ label: z.string().trim().min(1, "Every link needs a label").max(60), url: linkUrl })).max(20);
export const prefs = z.object({
  storeName: z.string().trim().min(1, "Enter a store name").max(60).default("UtsavVibe"),
  announcement: z.string().trim().max(200).default(""),
  tagline: z.string().trim().max(160).default("Festive & devotional gifts for every celebration."),
  metaTitle: z.string().trim().max(70).default(""),
  metaDescription: z.string().trim().max(320).default(""),
  // public https address of the store, used inside QR codes so phones can open them (empty = the address you are browsing)
  publicUrl: z.string().trim().max(200).refine((u) => !u || /^https?:\/\/[^\s/]+(:\d+)?$/.test(u.replace(/\/$/, "")), "Use a full address like https://utsavvibe.com").default(""),
  headerMenu: menu.default([{ label: "Shop", url: "/" }]),
  footerMenu: menu.default([]),
});
export type Prefs = z.infer<typeof prefs>;

export async function loadPrefs(): Promise<Prefs> {
  const row = await prisma.setting.findUnique({ where: { key: "onlineStore" } });
  return prefs.parse(parseJson(row?.value ?? "{}", {}));
}

onlineStoreRouter.get("/preferences", async (_req, res) => res.json(await loadPrefs()));
onlineStoreRouter.put("/preferences", async (req, res) => {
  const v = prefs.parse(req.body);
  await prisma.setting.upsert({ where: { key: "onlineStore" }, create: { key: "onlineStore", value: JSON.stringify(v) }, update: { value: JSON.stringify(v) } });
  res.json(v);
});
