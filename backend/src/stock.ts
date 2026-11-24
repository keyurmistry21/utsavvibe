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
  // Keep the Inventory page in step with the product page: a market served by exactly one location holds all of its stock there.
  const locs = await db.location.findMany({ where: { active: true }, select: { id: true, marketId: true, country: true } });
  const byMarket = new Map<string, string[]>();
  for (const l of locs) { const m = await marketOfLocation(db, l); if (m) byMarket.set(m, [...(byMarket.get(m) ?? []), l.id]); }
  for (const [marketId, ids] of byMarket) {
    if (ids.length !== 1) continue; // several locations: the owner splits it on the Inventory page
    const qty = stock[marketId]?.quantity;
    if (qty === undefined) await db.locationStock.deleteMany({ where: { variantId, locationId: ids[0] } });
    else await db.locationStock.upsert({ where: { variantId_locationId: { variantId, locationId: ids[0] } }, create: { variantId, locationId: ids[0], quantity: qty }, update: { quantity: qty } });
  }
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
