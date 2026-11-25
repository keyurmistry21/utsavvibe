// Inventory rules shared by storefront, checkout, drafts and the Stripe webhook.
type Flags = { trackInventory: boolean; continueSelling: boolean };

// Can `qty` of a variant with `inventory` on hand be sold?
export const canSell = (p: Flags, inventory: number, qty = 1) => !p.trackInventory || p.continueSelling || inventory >= qty;
// Only tracked products have their on-hand count reduced when an order is paid (continue-selling may go negative).
export const shouldDecrement = (p: Pick<Flags, "trackInventory">) => p.trackInventory;

type Tx = Omit<import("@prisma/client").PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/** Add (or remove, negative) stock for a market and keep the variant total (all markets) in step. No market = total only. */
export async function adjustStock(db: Tx, variantId: string, marketId: string | null, delta: number) {
  if (marketId)
    await db.inventoryLevel.upsert({ where: { variantId_marketId: { variantId, marketId } }, create: { variantId, marketId, quantity: delta }, update: { quantity: { increment: delta } } });
  await db.variant.update({ where: { id: variantId }, data: { inventory: { increment: delta } } });
}

/** An order took stock: reduce the stock of the market it was placed in. */
export async function takeStock(db: Tx, variantId: string, qty: number, marketId: string | null | undefined) {
  await adjustStock(db, variantId, marketId ?? null, -qty);
}

export type LevelInput = { quantity: number; sku?: string | null; barcode?: string | null };

/** Replace a variant's per-market counts and codes; the variant total becomes the sum of the counts. */
export async function setLevels(db: Tx, variantId: string, stock: Record<string, LevelInput>) {
  await db.inventoryLevel.deleteMany({ where: { variantId, marketId: { notIn: Object.keys(stock) } } });
  for (const [marketId, l] of Object.entries(stock)) {
    const data = { quantity: l.quantity, sku: l.sku?.trim() || null, barcode: l.barcode?.trim() || null };
    await db.inventoryLevel.upsert({ where: { variantId_marketId: { variantId, marketId } }, create: { variantId, marketId, ...data }, update: data });
  }
  await db.variant.update({ where: { id: variantId }, data: { inventory: Object.values(stock).reduce((a, b) => a + b.quantity, 0) } });
}

/** On-hand units a market can sell: its own level when it has one, else the variant total. */
export async function onHand(db: Tx, variantId: string, marketId: string) {
  const level = await db.inventoryLevel.findUnique({ where: { variantId_marketId: { variantId, marketId } }, select: { quantity: true } });
  if (level) return level.quantity;
  return (await db.variant.findUnique({ where: { id: variantId }, select: { inventory: true } }))?.inventory ?? 0;
}

export const RESERVE_MINUTES = 30; // unpaid storefront checkouts hold their units for this long

/** Units held by other unpaid checkouts in the same market (created within the reservation window). */
export async function reservedUnits(db: Tx, variantId: string, marketId: string) {
  const r = await db.orderItem.aggregate({
    _sum: { quantity: true },
    where: { variantId, order: { marketId, status: "open", paymentStatus: "pending", createdAt: { gt: new Date(Date.now() - RESERVE_MINUTES * 60_000) } } },
  });
  return r._sum.quantity ?? 0;
}

// ---------------- per-location stock ----------------
type Loc = { id: string; marketId: string | null; country: string };

/** The market a location serves: its own marketId, else the market that sells to its country, else the first market. */
export async function marketOfLocation(db: Tx, loc: Loc): Promise<string | null> {
  if (loc.marketId) return loc.marketId;
  const markets = await db.market.findMany({ where: { active: true }, select: { id: true, countries: true }, orderBy: { code: "asc" } });
  return markets.find((m) => { try { return (JSON.parse(m.countries) as string[]).includes(loc.country.toUpperCase()); } catch { return false; } })?.id ?? markets[0]?.id ?? null;
}

async function locationsOfMarket(db: Tx, marketId: string) {
  const locs = await db.location.findMany({ where: { active: true }, select: { id: true, marketId: true, country: true } });
  const out: string[] = [];
  for (const l of locs) if ((await marketOfLocation(db, l)) === marketId) out.push(l.id);
  return out;
}

/** Stock arrives at (+) or leaves (-) a location: its own count and the market/variant totals move together. */
export async function adjustLocationStock(db: Tx, variantId: string, locationId: string, delta: number) {
  const loc = await db.location.findUnique({ where: { id: locationId }, select: { id: true, marketId: true, country: true } });
  if (!loc) throw Object.assign(new Error("unknown location"), { status: 400 });
  const marketId = await marketOfLocation(db, loc);
  const row = await db.locationStock.findUnique({ where: { variantId_locationId: { variantId, locationId } } });
  if ((row?.quantity ?? 0) + delta < 0) throw Object.assign(new Error(`Only ${row?.quantity ?? 0} at that location`), { status: 409 });
  await db.locationStock.upsert({ where: { variantId_locationId: { variantId, locationId } }, create: { variantId, locationId, quantity: delta }, update: { quantity: { increment: delta } } });
  await adjustStock(db, variantId, marketId, delta);
}

/** Move market stock that has no location yet onto a location (nothing is added or removed overall). */
export async function assignUnassigned(db: Tx, variantId: string, locationId: string, quantity: number) {
  const loc = await db.location.findUnique({ where: { id: locationId }, select: { id: true, marketId: true, country: true } });
  if (!loc) throw Object.assign(new Error("unknown location"), { status: 400 });
  const marketId = await marketOfLocation(db, loc);
  if (!marketId) throw Object.assign(new Error("That location has no market"), { status: 400 });
  const level = await db.inventoryLevel.findUnique({ where: { variantId_marketId: { variantId, marketId } } });
  const ids = await locationsOfMarket(db, marketId);
  const assigned = (await db.locationStock.aggregate({ _sum: { quantity: true }, where: { variantId, locationId: { in: ids } } }))._sum.quantity ?? 0;
  const free = (level?.quantity ?? 0) - assigned;
  if (quantity > free) throw Object.assign(new Error(`Only ${Math.max(0, free)} unassigned in that market`), { status: 409 });
  await db.locationStock.upsert({ where: { variantId_locationId: { variantId, locationId } }, create: { variantId, locationId, quantity }, update: { quantity: { increment: quantity } } });
}

/**
 * A sale took `qty` from the market's stock (the market count is already reduced): take the same units from location counts.
 * The location rule: the preferred location first (the counter that made an in-store sale), then the location holding the most.
 * Returns the location that supplied most, for the order record. Missing location counts are fine (unassigned stock covers them).
 */
export async function allocateSale(db: Tx, variantId: string, qty: number, marketId: string, prefer?: string | null) {
  const ids = await locationsOfMarket(db, marketId);
  const rows = (await db.locationStock.findMany({ where: { variantId, locationId: { in: ids }, quantity: { gt: 0 } } })).sort((a, b) => (a.locationId === prefer ? -1 : b.locationId === prefer ? 1 : b.quantity - a.quantity));
  let left = qty, first: string | null = null;
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, r.quantity);
    await db.locationStock.update({ where: { variantId_locationId: { variantId, locationId: r.locationId } }, data: { quantity: { decrement: take } } });
    first ??= r.locationId;
    left -= take;
  }
  return first;
}

/** Remember a manual stock change so a wrong one can be put back from the Inventory history. */
export async function logMovement(db: Tx, m: { variantId: string; marketId?: string | null; locationId?: string | null; delta: number; source: "product" | "inventory" | "scan" | "restore"; reason?: string; actorEmail?: string; revertedAt?: Date }) {
  if (!m.delta) return;
  await db.stockMovement.create({ data: { variantId: m.variantId, marketId: m.marketId ?? null, locationId: m.locationId ?? null, delta: m.delta, source: m.source, reason: (m.reason ?? "").slice(0, 200), actorEmail: m.actorEmail ?? "", revertedAt: m.revertedAt ?? null } });
}

/** Undo one logged change: apply the opposite amount where it happened. Throws 409 when that would take stock below zero. */
export async function restoreMovement(db: Tx, id: string, actorEmail: string) {
  const mv = await db.stockMovement.findUnique({ where: { id } });
  if (!mv) throw Object.assign(new Error("That change was not found"), { status: 404 });
  if (mv.revertedAt || mv.source === "restore") throw Object.assign(new Error("That change was already put back"), { status: 409 });
  const flip = await db.stockMovement.updateMany({ where: { id, revertedAt: null }, data: { revertedAt: new Date() } });
  if (!flip.count) throw Object.assign(new Error("That change was just put back by someone else"), { status: 409 });
  if (mv.locationId) await adjustLocationStock(db, mv.variantId, mv.locationId, -mv.delta);
  else if (mv.marketId) {
    const levels = await db.inventoryLevel.findMany({ where: { variantId: mv.variantId } });
    const cur = levels.find((l) => l.marketId === mv.marketId)?.quantity ?? 0;
    if (cur - mv.delta < 0) throw Object.assign(new Error(`Only ${cur} left in that market, so it can't be put back`), { status: 409 });
    const map: Record<string, LevelInput> = Object.fromEntries(levels.map((l) => [l.marketId, { quantity: l.quantity, sku: l.sku, barcode: l.barcode }]));
    map[mv.marketId] = { ...(map[mv.marketId] ?? {}), quantity: cur - mv.delta };
    await setLevels(db, mv.variantId, map);
  } else throw Object.assign(new Error("Nothing to put back"), { status: 400 });
  await logMovement(db, { variantId: mv.variantId, marketId: mv.marketId, locationId: mv.locationId, delta: -mv.delta, source: "restore", reason: `Put back change from ${mv.createdAt.toISOString().slice(0, 10)}`, actorEmail, revertedAt: new Date() });
  return mv;
}

/** Remember a price change (only when it really changed) so it shows in the Inventory history and can be put back. */
export async function logPriceChange(db: Tx, c: { variantId: string; marketId: string; oldAmount: number; newAmount: number; oldCompareAt?: number | null; newCompareAt?: number | null; source: "product" | "prices" | "restore"; actorEmail?: string; revertedAt?: Date }) {
  if (c.oldAmount === c.newAmount && (c.oldCompareAt ?? null) === (c.newCompareAt ?? null)) return;
  await db.priceChange.create({ data: { variantId: c.variantId, marketId: c.marketId, oldAmount: c.oldAmount, newAmount: c.newAmount, oldCompareAt: c.oldCompareAt ?? null, newCompareAt: c.newCompareAt ?? null, source: c.source, actorEmail: c.actorEmail ?? "", revertedAt: c.revertedAt ?? null } });
}

/** Put a price back to what it was before the logged change. */
export async function restorePriceChange(db: Tx, id: string, actorEmail: string) {
  const c = await db.priceChange.findUnique({ where: { id } });
  if (!c) throw Object.assign(new Error("That change was not found"), { status: 404 });
  if (c.revertedAt || c.source === "restore") throw Object.assign(new Error("That change was already put back"), { status: 409 });
  const flip = await db.priceChange.updateMany({ where: { id, revertedAt: null }, data: { revertedAt: new Date() } });
  if (!flip.count) throw Object.assign(new Error("That change was just put back by someone else"), { status: 409 });
  const cur = await db.variantPrice.findUnique({ where: { variantId_marketId: { variantId: c.variantId, marketId: c.marketId } } });
  if (!cur) throw Object.assign(new Error("That product is no longer sold in this market"), { status: 409 });
  await db.variantPrice.update({ where: { variantId_marketId: { variantId: c.variantId, marketId: c.marketId } }, data: { amount: c.oldAmount, compareAt: c.oldCompareAt } });
  await logPriceChange(db, { variantId: c.variantId, marketId: c.marketId, oldAmount: cur.amount, newAmount: c.oldAmount, oldCompareAt: cur.compareAt, newCompareAt: c.oldCompareAt, source: "restore", actorEmail, revertedAt: new Date() });
}
