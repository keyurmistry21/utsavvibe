import { Router } from "express";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { normalizeHandle, sanitizeDescription } from "../html.js";
import { imageUrls } from "../storage.js";

// Admin side of Collections. Manual collections hold hand-picked products; smart ones match products by rules at read time.
export const collectionsRouter = Router();

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

export const FIELDS = ["tag", "vendor", "type", "title"] as const;
const ruleSet = z.object({
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(z.object({ field: z.enum(FIELDS), op: z.enum(["is", "contains"]).default("is"), value: z.string().trim().min(1, "Every rule needs a value").max(120) })).max(10).default([]),
});
export type RuleSet = z.infer<typeof ruleSet>;

const input = z.object({
  title: z.string().trim().min(1, "title is required").max(200),
  handle: z.string().trim().max(100).optional(),
  description: z.string().max(100_000).default(""),
  kind: z.enum(["manual", "smart"]).default("manual"),
  rules: ruleSet.default({ match: "all", conditions: [] }),
  productIds: z.array(z.string()).max(2000).default([]), // manual only, in display order
  visible: z.boolean().default(true),
  seoTitle: z.string().trim().max(200).default(""),
  seoDescription: z.string().trim().max(500).default(""),
});

type P = { id: string; title: string; vendor: string; productType: string; tags: string };
const lc = (s: string) => s.toLowerCase();
function matches(p: P, r: RuleSet) {
  if (!r.conditions.length) return false; // an empty smart collection matches nothing, never "everything"
  const test = (c: RuleSet["conditions"][number]) => {
    const v = lc(c.value);
    const hay = c.field === "tag" ? parseJson<string[]>(p.tags, []).map(lc) : [lc(c.field === "vendor" ? p.vendor : c.field === "type" ? p.productType : p.title)];
    return hay.some((h) => (c.op === "is" ? h === v : h.includes(v)));
  };
  return r.match === "all" ? r.conditions.every(test) : r.conditions.some(test);
}

/** Product ids in a collection, in display order (manual: by position; smart: newest first). */
export async function collectionProductIds(c: { id: string; kind: string; rules: string }): Promise<string[]> {
  if (c.kind === "manual") return (await prisma.collectionProduct.findMany({ where: { collectionId: c.id }, orderBy: [{ position: "asc" }, { productId: "asc" }], select: { productId: true } })).map((x) => x.productId);
  const rules = ruleSet.safeParse(parseJson(c.rules, {}));
  if (!rules.success) return [];
  const all = await prisma.product.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, title: true, vendor: true, productType: true, tags: true } });
  return all.filter((p) => matches(p, rules.data)).map((p) => p.id);
}

async function freeHandle(wanted: string, title: string, exceptId?: string) {
  const base = normalizeHandle(wanted || title) || "collection";
  for (let n = 1; n < 200; n++) {
    const h = n === 1 ? base : `${base}-${n}`;
    const hit = await prisma.collection.findUnique({ where: { handle: h }, select: { id: true } });
    if (!hit || hit.id === exceptId) return h;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function productRows(ids: string[]) {
  if (!ids.length) return [];
  const rows = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, status: true, images: { orderBy: { position: "asc" }, take: 1, select: { id: true } } } });
  const by = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => { const r = by.get(id); return r ? [{ id: r.id, title: r.title, status: r.status, thumbUrl: r.images[0] ? imageUrls(r.images[0].id).thumbUrl : null }] : []; });
}

const shape = async (c: { id: string; kind: string; rules: string; [k: string]: any }) => {
  const ids = await collectionProductIds(c);
  return { ...c, rules: ruleSet.catch({ match: "all", conditions: [] }).parse(parseJson(c.rules, {})), productCount: ids.length, products: await productRows(ids.slice(0, 500)) };
};

async function writeProducts(collectionId: string, kind: string, ids: string[]) {
  await prisma.collectionProduct.deleteMany({ where: { collectionId } });
  if (kind !== "manual" || !ids.length) return;
  const real = new Set((await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((p) => p.id));
  const uniq = [...new Set(ids)].filter((id) => real.has(id));
  await prisma.collectionProduct.createMany({ data: uniq.map((productId, position) => ({ collectionId, productId, position })) });
}

collectionsRouter.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const rows = await prisma.collection.findMany({ where: q ? { OR: [{ title: { contains: q } }, { handle: { contains: q } }] } : {}, orderBy: { updatedAt: "desc" } });
  res.json(await Promise.all(rows.map(async (c) => ({ id: c.id, title: c.title, handle: c.handle, kind: c.kind, visible: c.visible, updatedAt: c.updatedAt, productCount: (await collectionProductIds(c)).length }))));
});

// Live preview for the rule builder: which products would match, without saving.
collectionsRouter.post("/preview", async (req, res) => {
  const d = z.object({ rules: ruleSet }).parse(req.body);
  const ids = await collectionProductIds({ id: "", kind: "smart", rules: JSON.stringify(d.rules) });
  res.json({ count: ids.length, products: await productRows(ids.slice(0, 12)) });
});

collectionsRouter.get("/:id", async (req, res) => {
  const c = await prisma.collection.findUnique({ where: { id: req.params.id } });
  if (!c) return void res.status(404).json({ error: "collection not found" });
  res.json(await shape(c));
});

function check(d: z.infer<typeof input>) {
  if (d.kind === "smart" && !d.rules.conditions.length) throw bad("Add at least one rule so the collection knows which products to include");
}

collectionsRouter.post("/", async (req, res) => {
  const d = input.parse(req.body);
  check(d);
  if (d.handle && (await prisma.collection.findUnique({ where: { handle: normalizeHandle(d.handle) } }))) throw bad(`The URL handle "${normalizeHandle(d.handle)}" is already used by another collection`, 409);
  const c = await prisma.collection.create({
    data: { title: d.title, handle: await freeHandle(d.handle ?? "", d.title), description: sanitizeDescription(d.description), kind: d.kind, rules: JSON.stringify(d.kind === "smart" ? d.rules : { match: "all", conditions: [] }), visible: d.visible, seoTitle: d.seoTitle, seoDescription: d.seoDescription },
  });
  await writeProducts(c.id, d.kind, d.productIds);
  res.status(201).json(await shape(c));
});

collectionsRouter.put("/:id", async (req, res) => {
  const d = input.parse(req.body);
  check(d);
  const cur = await prisma.collection.findUnique({ where: { id: req.params.id } });
  if (!cur) return void res.status(404).json({ error: "collection not found" });
  const handle = normalizeHandle(d.handle || d.title) || cur.handle;
  const clash = await prisma.collection.findUnique({ where: { handle } });
  if (clash && clash.id !== cur.id) throw bad(`The URL handle "${handle}" is already used by another collection`, 409);
  const c = await prisma.collection.update({
    where: { id: cur.id },
    data: { title: d.title, handle, description: sanitizeDescription(d.description), kind: d.kind, rules: JSON.stringify(d.kind === "smart" ? d.rules : { match: "all", conditions: [] }), visible: d.visible, seoTitle: d.seoTitle, seoDescription: d.seoDescription },
  });
  await writeProducts(c.id, d.kind, d.productIds);
  res.json(await shape(c));
});

collectionsRouter.delete("/:id", async (req, res) => {
  await prisma.collection.deleteMany({ where: { id: req.params.id } });
  res.json({ ok: true });
});

collectionsRouter.post("/bulk", async (req, res) => {
  const d = z.object({ ids: z.array(z.string()).min(1).max(200), action: z.enum(["show", "hide", "delete"]) }).parse(req.body);
  if (d.action === "delete") await prisma.collection.deleteMany({ where: { id: { in: d.ids } } });
  else await prisma.collection.updateMany({ where: { id: { in: d.ids } }, data: { visible: d.action === "show" } });
  res.json({ ok: true });
});

// Storefront: visible collections, and the active products of one in a market.
export async function publicCollections() {
  const rows = await prisma.collection.findMany({ where: { visible: true }, orderBy: { title: "asc" }, select: { id: true, handle: true, title: true, kind: true, rules: true } });
  return rows.map(({ id, kind, rules, ...c }) => c);
}
export async function publicCollection(handle: string) {
  const c = await prisma.collection.findFirst({ where: { handle, visible: true } });
  if (!c) return null;
  return { collection: { handle: c.handle, title: c.title, descriptionHtml: c.description, seoTitle: c.seoTitle, seoDescription: c.seoDescription }, productIds: await collectionProductIds(c) };
}
