import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { actor, assertLocationAllowed, scopeCodes, scopeLocations } from "../auth.js";
import { audit } from "../audit.js";
import { imageUrls } from "../storage.js";
import { adjustLocationStock, assignUnassigned, logMovement, marketOfLocation, restoreMovement, restorePriceChange } from "../stock.js";

// Stock by location (warehouse, shop): counts, adjustments, assigning legacy per-market stock, and transfers between locations.
export const inventoryRouter = Router();
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

async function visibleLocations(req: Parameters<typeof scopeLocations>[0]) {
  const scope = scopeLocations(req);
  return prisma.location.findMany({ where: { active: true, ...(scope ? { id: { in: scope } } : {}) }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
}

// One row per variant: count at each visible location, units with no location yet, and the total.
// Locations are grouped Market → Region (state/province) → Location, so the same places carry price, tax and stock.
inventoryRouter.get("/", async (req, res) => {
  const locs = await visibleLocations(req);
  const allLocs = await prisma.location.findMany({ where: { active: true } });
  const q = String(req.query.q ?? "").trim();
  const variants = await prisma.variant.findMany({
    where: { product: { status: { not: "archived" }, ...(q ? { title: { contains: q } } : {}) } },
    include: { product: { select: { id: true, title: true, trackInventory: true, images: { orderBy: { position: "asc" }, take: 1, select: { id: true } } } }, levels: true },
    orderBy: [{ product: { title: "asc" } }, { title: "asc" }],
    take: 300,
  });
  const stock = await prisma.locationStock.findMany({ where: { variantId: { in: variants.map((v) => v.id) } } });
  const marketOf = new Map<string, string | null>();
  for (const l of allLocs) marketOf.set(l.id, await marketOfLocation(prisma, l));
  const rows = variants.map((v) => {
    const mine = stock.filter((s) => s.variantId === v.id);
    const byLocation: Record<string, number> = {};
    for (const l of locs) byLocation[l.id] = mine.find((s) => s.locationId === l.id)?.quantity ?? 0;
    // unassigned = market counts minus what the locations of that market hold
    let unassigned = 0;
    for (const lv of v.levels) unassigned += lv.quantity - mine.filter((s) => marketOf.get(s.locationId) === lv.marketId).reduce((a, s) => a + s.quantity, 0);
    const imgId = v.imageId ?? v.product.images[0]?.id;
    return { variantId: v.id, productId: v.product.id, thumbUrl: imgId ? imageUrls(imgId).thumbUrl : null, product: v.product.title, variant: v.title === "Default" ? "" : v.title, sku: v.sku, tracked: v.product.trackInventory, byLocation, unassigned: Math.max(0, unassigned), total: v.inventory };
  });
  const markets = await prisma.market.findMany({ where: { active: true }, include: { regions: true }, orderBy: { code: "asc" } });
  const mk = new Map(markets.map((m) => [m.id, m]));
  res.json({
    locations: locs.map((l) => { const mid = marketOf.get(l.id) ?? null; const m = mid ? mk.get(mid) : undefined; return { id: l.id, name: l.name, marketId: mid, marketCode: m?.code ?? "", marketName: m?.name ?? "", regionCode: l.regionCode, regionName: l.regionCode ? m?.regions.find((r) => r.code === l.regionCode)?.name ?? l.regionCode : "", isDefault: l.isDefault }; }),
    rows,
  });
});

// Receive new stock at a location (+) or write stock off (-).
inventoryRouter.post("/adjust", async (req, res) => {
  const d = z.object({ variantId: z.string(), locationId: z.string(), delta: z.number().int().min(-100000).max(100000).refine((n) => n !== 0, "Enter a quantity"), reason: z.string().trim().max(200).default("") }).parse(req.body);
  assertLocationAllowed(req, d.locationId);
  const loc = await prisma.location.findUnique({ where: { id: d.locationId } });
  await prisma.$transaction(async (tx) => { await adjustLocationStock(tx, d.variantId, d.locationId, d.delta); await logMovement(tx, { variantId: d.variantId, locationId: d.locationId, marketId: loc ? await marketOfLocation(tx, loc) : null, delta: d.delta, source: "inventory", reason: d.reason, actorEmail: actor(req).email }); });
  await audit(req, "stock_adjusted", `${d.delta > 0 ? "+" : ""}${d.delta} at location ${d.locationId} (${d.reason || "no reason"})`);
  res.json({ ok: true });
});

// Put stock that was counted per market (before locations existed) onto a location.
inventoryRouter.post("/assign", async (req, res) => {
  const d = z.object({ variantId: z.string(), locationId: z.string(), quantity: z.number().int().min(1).max(100000) }).parse(req.body);
  assertLocationAllowed(req, d.locationId);
  await prisma.$transaction((tx) => assignUnassigned(tx, d.variantId, d.locationId, d.quantity));
  res.json({ ok: true });
});

// One click for stores moving to locations: everything unassigned in this location's market goes onto this location.
inventoryRouter.post("/assign-all", async (req, res) => {
  const d = z.object({ locationId: z.string() }).parse(req.body);
  assertLocationAllowed(req, d.locationId);
  const loc = await prisma.location.findUnique({ where: { id: d.locationId } });
  if (!loc) throw bad("unknown location");
  const marketId = await marketOfLocation(prisma, loc);
  if (!marketId) throw bad("That location has no market");
  const levels = await prisma.inventoryLevel.findMany({ where: { marketId, quantity: { gt: 0 } } });
  let moved = 0;
  await prisma.$transaction(async (tx) => {
    for (const lv of levels) {
      const others = await tx.locationStock.findMany({ where: { variantId: lv.variantId } });
      const marketLocs = new Set((await tx.location.findMany({ where: { active: true } })).filter((l) => true).map((l) => l.id));
      let held = 0;
      for (const o of others) { const l = await tx.location.findUnique({ where: { id: o.locationId } }); if (l && (await marketOfLocation(tx, l)) === marketId && marketLocs.has(l.id)) held += o.quantity; }
      const free = lv.quantity - held;
      if (free > 0) { await assignUnassigned(tx, lv.variantId, d.locationId, free); moved += free; }
    }
  });
  await audit(req, "stock_assigned_all", `${moved} units to ${loc.name}`);
  res.json({ moved });
});

// ---- history: every manual stock change, with a way to put a wrong one back ----
inventoryRouter.get("/history", async (req, res) => {
  const scope = scopeLocations(req);
  const moves = await prisma.stockMovement.findMany({ where: scope ? { OR: [{ locationId: { in: scope } }, { locationId: null }] } : {}, orderBy: { createdAt: "desc" }, take: 200 });
  const prices = await prisma.priceChange.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const variants = await prisma.variant.findMany({ where: { id: { in: [...new Set([...moves.map((r) => r.variantId), ...prices.map((r) => r.variantId)])] } }, select: { id: true, title: true, product: { select: { id: true, title: true } } } });
  const vmap = new Map(variants.map((v) => [v.id, v]));
  const locs = new Map((await prisma.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
  const mkts = new Map((await prisma.market.findMany({ select: { id: true, code: true, currency: true } })).map((m) => [m.id, m]));
  const who = (variantId: string) => { const v = vmap.get(variantId); return { productId: v?.product.id ?? null, product: v?.product.title ?? "(deleted product)", variant: !v || v.title === "Default" ? "" : v.title }; };
  const rows = [
    ...moves.map((r) => ({ kind: "stock" as const, id: r.id, createdAt: r.createdAt, delta: r.delta, source: r.source, reason: r.reason, actorEmail: r.actorEmail, reverted: !!r.revertedAt, ...who(r.variantId), where: r.locationId ? locs.get(r.locationId) ?? "?" : r.marketId ? mkts.get(r.marketId)?.code ?? "?" : "" })),
    ...prices.map((r) => ({ kind: "price" as const, id: r.id, createdAt: r.createdAt, delta: 0, source: r.source, reason: "", actorEmail: r.actorEmail, reverted: !!r.revertedAt, ...who(r.variantId), where: mkts.get(r.marketId)?.code ?? "?", currency: mkts.get(r.marketId)?.currency ?? "", oldAmount: r.oldAmount, newAmount: r.newAmount })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 200);
  res.json(rows);
});

inventoryRouter.post("/history/:id/restore", async (req, res) => {
  const kind = req.query.kind === "price" ? "price" : "stock";
  if (kind === "price") await prisma.$transaction((tx) => restorePriceChange(tx, req.params.id, actor(req).email));
  else {
    const mv = await prisma.stockMovement.findUnique({ where: { id: req.params.id } });
    if (mv?.locationId) assertLocationAllowed(req, mv.locationId);
    await prisma.$transaction((tx) => restoreMovement(tx, req.params.id, actor(req).email));
  }
  await audit(req, kind === "price" ? "price_change_restored" : "stock_change_restored", req.params.id);
  res.json({ ok: true });
});

// ---- transfers ----
const include = { items: true } as const;
inventoryRouter.get("/transfers", async (req, res) => {
  const scope = scopeLocations(req);
  const rows = await prisma.stockTransfer.findMany({ where: scope ? { OR: [{ fromLocationId: { in: scope } }, { toLocationId: { in: scope } }] } : {}, include, orderBy: { createdAt: "desc" }, take: 100 });
  const names = new Map((await prisma.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
  res.json(rows.map((t) => ({ ...t, fromName: names.get(t.fromLocationId) ?? "?", toName: names.get(t.toLocationId) ?? "?" })));
});

inventoryRouter.post("/transfers", async (req, res) => {
  const d = z.object({ fromLocationId: z.string(), toLocationId: z.string(), note: z.string().trim().max(300).default(""), items: z.array(z.object({ variantId: z.string(), quantity: z.number().int().min(1).max(100000) })).min(1, "Add at least one item").max(100) }).parse(req.body);
  if (d.fromLocationId === d.toLocationId) throw bad("Choose two different locations");
  assertLocationAllowed(req, d.fromLocationId); // you can send from places you work at
  const merged = new Map<string, number>();
  for (const i of d.items) merged.set(i.variantId, (merged.get(i.variantId) ?? 0) + i.quantity);
  const t = await prisma.$transaction(async (tx) => {
    const lines = [];
    for (const [variantId, quantity] of merged) {
      const v = await tx.variant.findUnique({ where: { id: variantId }, select: { title: true, product: { select: { title: true } } } });
      if (!v) throw bad("Unknown item");
      await adjustLocationStock(tx, variantId, d.fromLocationId, -quantity); // throws 409 when the source holds fewer
      lines.push({ variantId, quantity, title: v.title === "Default" ? v.product.title : `${v.product.title} — ${v.title}` });
    }
    return tx.stockTransfer.create({ data: { fromLocationId: d.fromLocationId, toLocationId: d.toLocationId, note: d.note, createdByEmail: actor(req).email, items: { create: lines } }, include });
  });
  await audit(req, "stock_transfer_created", `${merged.size} item(s) ${d.fromLocationId} -> ${d.toLocationId}`);
  res.status(201).json(t);
});

inventoryRouter.post("/transfers/:id/receive", async (req, res) => {
  const t = await prisma.stockTransfer.findUnique({ where: { id: req.params.id }, include });
  if (!t) throw bad("not found", 404);
  assertLocationAllowed(req, t.toLocationId);
  if (t.status !== "in_transit") throw bad("This transfer is already " + t.status, 409);
  await prisma.$transaction(async (tx) => {
    const flip = await tx.stockTransfer.updateMany({ where: { id: t.id, status: "in_transit" }, data: { status: "received", receivedAt: new Date() } });
    if (!flip.count) throw bad("This transfer was just updated by someone else", 409);
    for (const i of t.items) await adjustLocationStock(tx, i.variantId, t.toLocationId, i.quantity);
  });
  await audit(req, "stock_transfer_received", t.id);
  res.json({ ok: true });
});

// Cancelling puts the units back where they came from.
inventoryRouter.post("/transfers/:id/cancel", async (req, res) => {
  const t = await prisma.stockTransfer.findUnique({ where: { id: req.params.id }, include });
  if (!t) throw bad("not found", 404);
  assertLocationAllowed(req, t.fromLocationId);
  if (t.status !== "in_transit") throw bad("This transfer is already " + t.status, 409);
  await prisma.$transaction(async (tx) => {
    const flip = await tx.stockTransfer.updateMany({ where: { id: t.id, status: "in_transit" }, data: { status: "cancelled" } });
    if (!flip.count) throw bad("This transfer was just updated by someone else", 409);
    for (const i of t.items) await adjustLocationStock(tx, i.variantId, t.fromLocationId, i.quantity);
  });
  await audit(req, "stock_transfer_cancelled", t.id);
  res.json({ ok: true });
});
