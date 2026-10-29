import { Router, raw, text } from "express";
import type { Request } from "express";
import { actor } from "../auth.js";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { processImage } from "../images.js";
import { csvCell } from "../csv.js";
import { normalizeHandle, sanitizeDescription } from "../html.js";
import { importProduct, keepParsed, parseShopify, takeParsed } from "../shopifyImport.js";
import { imageFiles, imageUrls, removeFiles, saveFile } from "../storage.js";

export const productsRouter = Router();

const price = z.object({ amount: z.number().int().min(0), compareAt: z.number().int().min(0).nullable().optional() });

const productInput = z.object({
  title: z.string().min(1),
  handle: z.string().min(1).optional(),
  description: z.string().default(""),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
  vendor: z.string().trim().max(120).default(""),
  productType: z.string().trim().max(120).default(""),
  trackInventory: z.boolean().default(true),
  continueSelling: z.boolean().default(false),
  physical: z.boolean().default(true),
  chargeTax: z.boolean().default(true),
  isGiftCard: z.boolean().default(false), // variants are denominations; paying issues a gift card code
  seoTitle: z.string().trim().max(70).default(""),
  seoDescription: z.string().trim().max(320).default(""),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(""),
  marketIds: z.array(z.string()).min(1, "select at least one market"),
  // optional per-market subset of provinces/states; missing or empty = sold across the whole market
  regions: z.record(z.string(), z.array(z.string())).default({}),
  variants: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().default("Default"),
        options: z.record(z.string(), z.string()).default({}),
        sku: z.string().trim().max(64).nullable().optional(),
        inventory: z.number().int().min(0).default(0),
        weightG: z.number().int().min(0).default(0),
        barcode: z.string().trim().max(64).nullable().optional(),
        costPerItem: z.number().int().min(0).nullable().optional(),
        // keyed by marketId
        prices: z.record(z.string(), price),
      }),
    )
    .min(1),
});

// a gift card is a voucher: nothing to ship, nothing to count, and gift cards are not taxed when sold (tax applies when the balance is spent)
const flags = (d: z.infer<typeof productInput>) => ({
  isGiftCard: d.isGiftCard,
  trackInventory: d.isGiftCard ? false : d.trackInventory, continueSelling: d.continueSelling, physical: d.isGiftCard ? false : d.physical, chargeTax: d.isGiftCard ? false : d.chargeTax,
  seoTitle: d.seoTitle, seoDescription: d.seoDescription || null,
});

// Nice URL for a new product: "brass-lamp", then "brass-lamp-2", "brass-lamp-3"…
async function freeHandle(base: string) {
  for (let n = 1; n < 200; n++) {
    const h = n === 1 ? base : `${base}-${n}`;
    if (!(await prisma.product.findUnique({ where: { handle: h }, select: { id: true } }))) return h;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// URL handle must be unique; the product being edited may keep its own.
async function uniqueHandle(handle: string, selfId?: string) {
  if (!handle) throw Object.assign(new Error("URL handle can't be empty"), { status: 400 });
  const other = await prisma.product.findUnique({ where: { handle } });
  if (other && other.id !== selfId) throw Object.assign(new Error(`The URL handle "${handle}" is already used by another product`), { status: 409 });
  return handle;
}

const regionsJson = (d: z.infer<typeof productInput>, marketId: string) => {
  const r = d.regions[marketId];
  return r && r.length ? JSON.stringify(r) : null;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const include = {
  markets: true,
  variants: { include: { prices: true } },
  images: { orderBy: { position: "asc" } },
} as const;

const shape = (p: any) => ({
  ...p,
  seoDescription: p.seoDescription ?? "",
  images: (p.images ?? []).map((i: any) => ({ id: i.id, alt: i.alt, position: i.position, width: i.width, height: i.height, ...imageUrls(i.id) })),
  tags: parseJson<string[]>(p.tags, []),
  marketIds: p.markets.map((m: any) => m.marketId),
  regions: Object.fromEntries(p.markets.map((m: any) => [m.marketId, parseJson<string[]>(m.regions ?? "[]", [])])),
  variants: p.variants.map((v: any) => ({
    ...v,
    options: parseJson(v.options, {}),
    prices: Object.fromEntries(v.prices.map((x: any) => [x.marketId, { amount: x.amount, compareAt: x.compareAt }])),
  })),
});

// Every selected market must have a price for every variant.
function assertPrices(d: z.infer<typeof productInput>) {
  for (const v of d.variants)
    for (const mid of d.marketIds)
      if (!v.prices[mid]) throw Object.assign(new Error(`variant "${v.title}" missing price for market ${mid}`), { status: 400 });
}

function variantData(v: z.infer<typeof productInput>["variants"][number], marketIds: string[]) {
  return {
    title: v.title,
    options: JSON.stringify(v.options),
    sku: v.sku || null,
    inventory: v.inventory,
    weightG: v.weightG,
    barcode: v.barcode || null,
    costPerItem: v.costPerItem ?? null,
    prices: { create: marketIds.map((marketId) => ({ marketId, ...v.prices[marketId], compareAt: v.prices[marketId].compareAt ?? null })) },
  };
}

productsRouter.get("/", async (req, res) => {
  const { status, tag, q } = req.query as Record<string, string | undefined>;
  const products = await prisma.product.findMany({
    where: { ...(status ? { status } : {}), ...(q ? { title: { contains: q } } : {}), ...(tag ? { tags: { contains: JSON.stringify(tag) } } : {}) },
    include,
    orderBy: { createdAt: "desc" },
  });
  res.json(products.map(shape));
});

// ---- list page (paged), stats, bulk actions, export ----
const listQuery = z.object({
  q: z.string().trim().default(""),
  status: z.enum(["all", "active", "draft", "archived"]).default("all"),
  filter: z.enum(["all", "out_of_stock", "low_stock"]).default("all"),
  sort: z.enum(["updated", "created", "title"]).default("updated"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  market: z.string().max(8).default(""), // market code: only products sold there
});
const LOW_STOCK = 5;

function productWhere(q: z.infer<typeof listQuery>) {
  const text = q.q;
  return {
    ...(q.market ? { markets: { some: { market: { code: q.market.toUpperCase() } } } } : {}),
    ...(q.status !== "all" ? { status: q.status } : {}),
    ...(text ? { OR: [{ title: { contains: text } }, { vendor: { contains: text } }, { productType: { contains: text } }, { tags: { contains: text } }, { variants: { some: { sku: { contains: text } } } }] } : {}),
    ...(q.filter === "out_of_stock" ? { variants: { none: { inventory: { gt: 0 } } } } : {}),
    ...(q.filter === "low_stock" ? { variants: { some: { inventory: { gt: 0, lte: LOW_STOCK } } } } : {}),
  };
}

const listInclude = {
  images: { orderBy: { position: "asc" as const }, take: 1 },
  variants: { select: { inventory: true, prices: { select: { amount: true, marketId: true } } } },
  markets: { include: { market: { select: { code: true, currency: true } } } },
};

function summarize(p: any) {
  const prices: Record<string, { currency: string; min: number }> = {};
  for (const m of p.markets) {
    const mins = p.variants.flatMap((v: any) => v.prices.filter((x: any) => x.marketId === m.marketId).map((x: any) => x.amount));
    if (mins.length) prices[m.market.code] = { currency: m.market.currency, min: Math.min(...mins) };
  }
  return {
    id: p.id, title: p.title, handle: p.handle, status: p.status, vendor: p.vendor, productType: p.productType,
    tags: parseJson<string[]>(p.tags, []), createdAt: p.createdAt, updatedAt: p.updatedAt,
    thumbUrl: p.images[0] ? imageUrls(p.images[0].id).thumbUrl : null,
    inventory: p.variants.reduce((s: number, v: any) => s + v.inventory, 0),
    variantCount: p.variants.length,
    markets: p.markets.map((m: any) => m.market.code).sort(),
    prices,
  };
}

productsRouter.get("/list", async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = productWhere(q);
  const orderBy = q.sort === "title" ? [{ title: q.dir }, { id: q.dir }] : q.sort === "created" ? [{ createdAt: q.dir }, { id: q.dir }] : [{ updatedAt: q.dir }, { id: q.dir }];
  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy, take: q.limit, skip: q.offset, include: listInclude }),
    prisma.product.count({ where }),
  ]);
  res.json({ items: rows.map(summarize), total });
});

productsRouter.get("/stats", async (_req, res) => {
  const [total, active, draft, archived, out] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { status: "active" } }),
    prisma.product.count({ where: { status: "draft" } }),
    prisma.product.count({ where: { status: "archived" } }),
    prisma.product.count({ where: { status: { not: "archived" }, variants: { none: { inventory: { gt: 0 } } } } }),
  ]);
  res.json({ total, active, draft, archived, outOfStock: out });
});

productsRouter.post("/bulk", async (req, res) => {
  const { ids, action } = z.object({ ids: z.array(z.string()).min(1).max(200), action: z.enum(["activate", "draft", "archive", "delete"]) }).parse(req.body);
  if (action !== "delete") {
    const r = await prisma.product.updateMany({ where: { id: { in: ids } }, data: { status: action === "activate" ? "active" : action === "draft" ? "draft" : "archived" } });
    return void res.json({ updated: r.count, deleted: 0, archived: 0 });
  }
  let deleted = 0, archived = 0;
  for (const id of ids) {
    // products that were ever ordered are archived instead, so order history stays intact
    if (await prisma.orderItem.count({ where: { variant: { productId: id } } })) {
      await prisma.product.update({ where: { id }, data: { status: "archived" } }).catch(() => {});
      archived++;
      continue;
    }
    const imgs = await prisma.productImage.findMany({ where: { productId: id }, select: { id: true } });
    const r = await prisma.product.deleteMany({ where: { id } });
    if (r.count) { deleted++; await removeFiles(imgs.flatMap((i) => imageFiles(i.id))); }
  }
  res.json({ updated: 0, deleted, archived });
});

// One row per variant, with a price column for every market.
productsRouter.get("/export", async (req, res) => {
  const ids = String(req.query.ids ?? "").split(",").filter(Boolean);
  const q = listQuery.parse({ ...req.query, limit: 100, offset: 0 });
  const [products, markets] = await Promise.all([
    prisma.product.findMany({ where: ids.length ? { id: { in: ids } } : productWhere(q), orderBy: { createdAt: "asc" }, take: 10000, include: { variants: { include: { prices: true } }, markets: true } }),
    prisma.market.findMany({ orderBy: { code: "asc" } }),
  ]);
  const header = ["Handle", "Title", "Status", "Vendor", "Type", "Tags", "Variant", "Options", "SKU", "Inventory", ...markets.flatMap((m) => [`Price ${m.code} (${m.currency})`, `Compare-at ${m.code} (${m.currency})`]), "Markets", "Notes"];
  const lines = products.flatMap((p) =>
    p.variants.map((v) => {
      const price = (mid: string) => v.prices.find((x) => x.marketId === mid);
      const money = (n?: number | null) => (n == null ? "" : (n / 100).toFixed(2));
      return [p.handle, p.title, p.status, p.vendor, p.productType, parseJson<string[]>(p.tags, []).join(", "), v.title, Object.entries(parseJson<Record<string, string>>(v.options, {})).map(([k, x]) => `${k}=${x}`).join("; "), v.sku, v.inventory, ...markets.flatMap((m) => [money(price(m.id)?.amount), money(price(m.id)?.compareAt)]), p.markets.map((pm) => markets.find((m) => m.id === pm.marketId)?.code).filter(Boolean).join(", "), p.notes].map(csvCell).join(",");
    }),
  );
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([header.map(csvCell).join(","), ...lines].join("\r\n"));
});

// ---- Shopify CSV import ----
// Step 1: upload the CSV text (preview, nothing is written). Step 2: import in small batches of handles so big catalogs and image downloads don't time out.
const csvBody = text({ type: () => true, limit: "20mb" });
const uid = (req: Request) => String(actor(req)?.id ?? "admin");

productsRouter.post("/import/preview", csvBody, async (req, res) => {
  if (typeof req.body !== "string" || !req.body.trim()) throw Object.assign(new Error("Choose a CSV file first"), { status: 400 });
  const parsed = parseShopify(req.body);
  const [markets, existing] = await Promise.all([
    prisma.market.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true, currency: true, countries: true } }),
    prisma.product.findMany({ where: { handle: { in: parsed.products.map((p) => p.handle) } }, select: { handle: true } }),
  ]);
  const have = new Set(existing.map((e) => e.handle));
  const regionName = new Intl.DisplayNames(["en"], { type: "region" });
  res.json({
    token: keepParsed(parsed, uid(req)),
    skippedRows: parsed.skipped,
    priceColumns: parsed.priceColumns,
    markets: markets.map((m) => ({
      id: m.id, code: m.code, name: m.name, currency: m.currency,
      // "Price / United Kingdom" style columns Shopify adds when a store sells in several markets
      suggested: parsed.priceColumns.find((c) => parseJsonArr(m.countries).some((cc) => c.toLowerCase().endsWith(` / ${regionName.of(cc)?.toLowerCase()}`))) ?? null,
    })),
    products: parsed.products.map((p) => ({ handle: p.handle, title: p.title, status: p.status, variants: p.variants.length, images: p.images.length, exists: have.has(p.handle), samplePrice: p.variants[0]?.price ?? "" })),
  });
});

const parseJsonArr = (s: string) => parseJson<string[]>(s, []);

productsRouter.post("/import", async (req, res) => {
  const d = z.object({
    token: z.string().min(10).max(80),
    handles: z.array(z.string()).min(1).max(15),
    markets: z.array(z.object({ marketId: z.string(), source: z.string().max(200) })).min(1, "Choose at least one market to sell in"),
    images: z.boolean().default(true),
  }).parse(req.body);
  const parsed = takeParsed(d.token, uid(req));
  const real = new Set((await prisma.market.findMany({ where: { id: { in: d.markets.map((m) => m.marketId) } }, select: { id: true } })).map((m) => m.id));
  if (d.markets.some((m) => !real.has(m.marketId))) throw Object.assign(new Error("unknown market"), { status: 400 });
  for (const m of d.markets) if (m.source !== "base" && !parsed.priceColumns.includes(m.source)) throw Object.assign(new Error("unknown price column"), { status: 400 });
  const wanted = new Set(d.handles);
  const out = [];
  for (const p of parsed.products.filter((x) => wanted.has(x.handle))) {
    try { out.push(await importProduct(p, { markets: d.markets, images: d.images })); }
    catch (e) { out.push({ handle: p.handle, status: "failed" as const, message: (e as Error).message.slice(0, 200), warnings: [] }); }
  }
  res.json({ results: out });
});

// Which of these SKUs / barcodes are already used by another product? Powers the Generate buttons in the editor.
productsRouter.post("/codes/taken", async (req, res) => {
  const d = z.object({ skus: z.array(z.string().max(64)).max(200).default([]), barcodes: z.array(z.string().max(64)).max(200).default([]), productId: z.string().optional() }).parse(req.body);
  const other = d.productId ? { productId: { not: d.productId } } : {};
  const [s, b] = await Promise.all([
    d.skus.length ? prisma.variant.findMany({ where: { sku: { in: d.skus }, ...other }, select: { sku: true } }) : [],
    d.barcodes.length ? prisma.variant.findMany({ where: { barcode: { in: d.barcodes }, ...other }, select: { barcode: true } }) : [],
  ]);
  res.json({ skus: s.map((x) => x.sku), barcodes: b.map((x) => x.barcode) });
});

productsRouter.get("/:id", async (req, res) => {
  const p = await prisma.product.findUnique({ where: { id: req.params.id }, include });
  if (!p) return void res.status(404).json({ error: "not found" });
  res.json(shape(p));
});

productsRouter.post("/", async (req, res) => {
  const d = productInput.parse(req.body);
  assertPrices(d);
  const p = await prisma.product.create({
    data: {
      title: d.title,
      handle: d.handle ? await uniqueHandle(normalizeHandle(d.handle)) : await freeHandle(slug(d.title) || "product"),
      description: sanitizeDescription(d.description),
      status: d.status,
      vendor: d.vendor,
      productType: d.productType,
      ...flags(d),
      tags: JSON.stringify(d.tags),
      notes: d.notes,
      markets: { create: d.marketIds.map((marketId) => ({ marketId, regions: regionsJson(d, marketId) })) },
      variants: { create: d.variants.map((v) => variantData(v, d.marketIds)) },
    },
    include,
  });
  res.status(201).json(shape(p));
});

// Full replace of variants/prices: simple and predictable for an admin form.
// Variants that already have order items are kept by id so order history stays valid.
productsRouter.put("/:id", async (req, res) => {
  const d = productInput.parse(req.body);
  assertPrices(d);
  const id = req.params.id;
  const p = await prisma.$transaction(async (tx) => {
    const keepIds = d.variants.map((v) => v.id).filter((x): x is string => !!x);
    await tx.variant.deleteMany({ where: { productId: id, id: { notIn: keepIds }, orderItems: { none: {} } } });
    await tx.productMarket.deleteMany({ where: { productId: id } });
    for (const v of d.variants) {
      const { prices, ...rest } = variantData(v, d.marketIds);
      if (v.id) {
        await tx.variantPrice.deleteMany({ where: { variantId: v.id } });
        await tx.variant.update({ where: { id: v.id }, data: { ...rest, prices } });
      } else {
        await tx.variant.create({ data: { ...rest, productId: id, prices } });
      }
    }
    return tx.product.update({
      where: { id },
      data: {
        title: d.title,
        ...(d.handle ? { handle: await uniqueHandle(normalizeHandle(d.handle), id) } : {}),
        description: sanitizeDescription(d.description),
        status: d.status,
        vendor: d.vendor,
        productType: d.productType,
        ...flags(d),
        tags: JSON.stringify(d.tags),
        notes: d.notes,
        markets: { create: d.marketIds.map((marketId) => ({ marketId, regions: regionsJson(d, marketId) })) },
      },
      include,
    });
  });
  res.json(shape(p));
});

productsRouter.delete("/:id", async (req, res) => {
  const used = await prisma.orderItem.count({ where: { variant: { productId: req.params.id } } });
  if (used) {
    await prisma.product.update({ where: { id: req.params.id }, data: { status: "archived" } });
    return void res.json({ archived: true });
  }
  const imgs = await prisma.productImage.findMany({ where: { productId: req.params.id }, select: { id: true } });
  await prisma.product.delete({ where: { id: req.params.id } });
  await removeFiles(imgs.flatMap((i) => imageFiles(i.id)));
  res.json({ deleted: true });
});

// ---- images ----
const MAX_IMAGES = 10;

// Raw binary body (not multipart): the file is the request body, alt text in a header.
productsRouter.post("/:id/images", raw({ type: () => true, limit: "12mb" }), async (req, res) => {
  const productId = req.params.id as string;
  if (!(await prisma.product.findUnique({ where: { id: productId }, select: { id: true } }))) return void res.status(404).json({ error: "not found" });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return void res.status(400).json({ error: "empty upload" });
  const count = await prisma.productImage.count({ where: { productId } });
  if (count >= MAX_IMAGES) return void res.status(400).json({ error: `max ${MAX_IMAGES} images per product` });

  const out = await processImage(req.body);
  const alt = decodeURIComponent(req.header("x-image-alt") ?? "").slice(0, 190);
  const last = await prisma.productImage.findFirst({ where: { productId }, orderBy: { position: "desc" }, select: { position: true } });
  const img = await prisma.productImage.create({ data: { productId, alt, position: (last?.position ?? -1) + 1, width: out.width, height: out.height } });
  try {
    await saveFile(`${img.id}.webp`, out.full);
    await saveFile(`${img.id}-thumb.webp`, out.thumb);
  } catch (e) {
    await prisma.productImage.delete({ where: { id: img.id } });
    throw e;
  }
  res.status(201).json({ id: img.id, alt: img.alt, position: img.position, width: img.width, height: img.height, ...imageUrls(img.id) });
});

productsRouter.put("/:id/images/order", async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);
  const own = await prisma.productImage.findMany({ where: { productId: req.params.id }, select: { id: true } });
  if (ids.length !== own.length || !ids.every((i) => own.some((o) => o.id === i))) return void res.status(400).json({ error: "ids must list every image of this product" });
  await prisma.$transaction(ids.map((id, position) => prisma.productImage.update({ where: { id }, data: { position } })));
  res.json({ ok: true });
});

productsRouter.patch("/:id/images/:imageId", async (req, res) => {
  const { alt } = z.object({ alt: z.string().max(190) }).parse(req.body);
  const r = await prisma.productImage.updateMany({ where: { id: req.params.imageId, productId: req.params.id }, data: { alt } });
  if (!r.count) return void res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

productsRouter.delete("/:id/images/:imageId", async (req, res) => {
  const img = await prisma.productImage.findFirst({ where: { id: req.params.imageId, productId: req.params.id } });
  if (!img) return void res.status(404).json({ error: "not found" });
  await prisma.productImage.delete({ where: { id: img.id } });
  await removeFiles(imageFiles(img.id));
  // keep positions dense so the cover is always position 0
  const rest = await prisma.productImage.findMany({ where: { productId: req.params.id }, orderBy: { position: "asc" }, select: { id: true } });
  await prisma.$transaction(rest.map((r, position) => prisma.productImage.update({ where: { id: r.id }, data: { position } })));
  res.json({ deleted: true });
});
