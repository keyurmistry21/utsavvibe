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
