import { Router, raw } from "express";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { processImage } from "../images.js";
import { imageFiles, imageUrls, removeFiles, saveFile } from "../storage.js";

export const productsRouter = Router();

const price = z.object({ amount: z.number().int().min(0), compareAt: z.number().int().min(0).nullable().optional() });

const productInput = z.object({
  title: z.string().min(1),
  handle: z.string().min(1).optional(),
  description: z.string().default(""),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
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
        sku: z.string().nullable().optional(),
        inventory: z.number().int().min(0).default(0),
        weightG: z.number().int().min(0).default(0),
        // keyed by marketId
        prices: z.record(z.string(), price),
      }),
    )
    .min(1),
});

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
      handle: d.handle ?? `${slug(d.title)}-${Date.now().toString(36)}`,
      description: d.description,
      status: d.status,
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
        description: d.description,
        status: d.status,
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
