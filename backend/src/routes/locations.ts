import { Router } from "express";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";

// Locations (warehouses, shops). Mounted behind guard(settings.manage).
export const locationsRouter = Router();
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

const input = z.object({
  name: z.string().trim().min(1, "Enter a location name").max(100),
  company: z.string().trim().max(100).default(""),
  line1: z.string().trim().min(1, "Enter a street address").max(200),
  line2: z.string().trim().max(200).default(""),
  city: z.string().trim().min(1, "Enter a city").max(100),
  region: z.string().trim().max(60).default(""),
  postcode: z.string().trim().min(1, "Enter a postal code").max(12),
  country: z.string().trim().toUpperCase().length(2, "Choose a country"),
  phone: z.string().trim().max(30).default(""),
  active: z.boolean().default(true),
  marketId: z.string().max(40).nullable().optional(),
  regionCode: z.string().trim().max(10).nullable().optional(), // state/province (a region of the location's market)
});

// A region only makes sense inside a market; clear it when the market has no such region.
async function cleanRegion(d: z.infer<typeof input>) {
  if (!d.regionCode) return { ...d, regionCode: null };
  const market = d.marketId ? await prisma.market.findUnique({ where: { id: d.marketId }, include: { regions: true } }) : null;
  if (!market || !market.regions.some((r) => r.code === d.regionCode)) throw Object.assign(new Error("Choose a market, then one of its states or provinces"), { status: 400 });
  return d;
}

/** The sender address for labels: the default location, else the legacy ship-from setting. */
export async function shipFromAddress() {
  const loc = (await prisma.location.findFirst({ where: { isDefault: true } })) ?? (await prisma.location.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }));
  if (loc) return { name: loc.name, company: loc.company, line1: loc.line1, line2: loc.line2, city: loc.city, region: loc.region, postcode: loc.postcode, country: loc.country, phone: loc.phone };
  const row = await prisma.setting.findUnique({ where: { key: "shipFrom" } });
  return parseJson<Record<string, string>>(row?.value ?? "{}", {});
}

/** Startup: a store that already set a ship-from address gets it as its first (default) location. */
export async function ensureDefaultLocation() {
  if (await prisma.location.count()) return;
  const row = await prisma.setting.findUnique({ where: { key: "shipFrom" } });
  const f = parseJson<Record<string, string>>(row?.value ?? "{}", {});
  if (!f.line1 && !f.city) return;
  await prisma.location.create({ data: { name: f.name || f.company || "Main location", company: f.company ?? "", line1: f.line1 ?? "", line2: f.line2 ?? "", city: f.city ?? "", region: f.region ?? "", postcode: f.postcode ?? "", country: (f.country ?? "").toUpperCase().slice(0, 2), phone: f.phone ?? "", isDefault: true } });
}

/** Startup: stock counted before per-market stock existed (Variant.inventory) goes to the first market the product sells in. */
export async function ensureStockLevels() {
  const vars = await prisma.variant.findMany({ where: { levels: { none: {} }, inventory: { not: 0 } }, select: { id: true, inventory: true, product: { select: { markets: { select: { marketId: true }, orderBy: { marketId: "asc" } } } } } });
  const fallback = (await prisma.market.findFirst({ where: { active: true }, orderBy: { code: "asc" } }))?.id;
  for (const v of vars) {
    const marketId = v.product.markets[0]?.marketId ?? fallback;
    if (marketId) await prisma.inventoryLevel.create({ data: { variantId: v.id, marketId, quantity: v.inventory } });
  }
}

locationsRouter.get("/", async (_req, res) => {
  res.json(await prisma.location.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }));
});

locationsRouter.post("/", async (req, res) => {
  const d = input.parse(req.body);
  const first = (await prisma.location.count()) === 0;
  res.status(201).json(await prisma.location.create({ data: { ...(await cleanRegion(d)), active: first ? true : d.active, isDefault: first } }));
});

locationsRouter.put("/:id", async (req, res) => {
  const d = input.parse(req.body);
  const cur = await prisma.location.findUnique({ where: { id: req.params.id } });
  if (!cur) throw bad("Location not found", 404);
  if (cur.isDefault && !d.active) throw bad("The default location can't be deactivated. Make another location the default first.");
  res.json(await prisma.location.update({ where: { id: cur.id }, data: await cleanRegion(d) }));
});

locationsRouter.post("/:id/default", async (req, res) => {
  const cur = await prisma.location.findUnique({ where: { id: req.params.id } });
  if (!cur) throw bad("Location not found", 404);
  await prisma.$transaction([
    prisma.location.updateMany({ data: { isDefault: false } }),
    prisma.location.update({ where: { id: cur.id }, data: { isDefault: true, active: true } }),
  ]);
  res.json({ ok: true });
});

locationsRouter.delete("/:id", async (req, res) => {
  const cur = await prisma.location.findUnique({ where: { id: req.params.id } });
  if (!cur) return void res.json({ ok: true });
  if (cur.isDefault) throw bad("The default location can't be deleted. Make another location the default first.");
  await prisma.location.delete({ where: { id: cur.id } });
  res.json({ ok: true });
});
