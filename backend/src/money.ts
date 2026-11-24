// All amounts are integer minor units (pence/cents). taxRateBps: 2000 = 20%.
export function computeTax(subtotal: number, taxRateBps: number, inclusive: boolean): number {
  if (taxRateBps <= 0) return 0;
  if (inclusive) return Math.round(subtotal - subtotal / (1 + taxRateBps / 10000));
  return Math.round((subtotal * taxRateBps) / 10000);
}

export function computeTotal(subtotal: number, tax: number, shipping: number, inclusive: boolean): number {
  return subtotal + (inclusive ? 0 : tax) + shipping;
}

// Discount is spread proportionally over all items, so it also reduces the taxable portion.
// taxableSubtotal = value of items flagged taxable (defaults to the whole subtotal). Shipping is untaxed.
export function priceTotals(o: { exempt?: boolean; subtotal: number; taxableSubtotal?: number; discount?: number; taxRateBps: number; inclusive: boolean; shipping: number }) {
  const discount = Math.min(o.discount ?? 0, o.subtotal);
  const base = o.subtotal - discount;
  const taxable = Math.min(o.taxableSubtotal ?? o.subtotal, o.subtotal);
  const taxBase = o.subtotal > 0 ? Math.round(taxable - (discount * taxable) / o.subtotal) : 0;
  const tax = computeTax(taxBase, o.taxRateBps, o.inclusive);
  // tax-exempt customer: no tax, and where prices include tax they pay the net price
  if (o.exempt) return { discount, tax: 0, total: (o.inclusive ? base - tax : base) + o.shipping };
  return { discount, tax, total: computeTotal(base, tax, o.shipping, o.inclusive) };
}

export function pickShipping(
  rates: { id: string; name: string; amount: number; freeOverAmount: number | null }[],
  subtotal: number,
  rateId?: string,
) {
  const rate = rates.find((r) => r.id === rateId) ?? rates[0];
  if (!rate) return { rate: null, amount: 0 };
  const free = rate.freeOverAmount != null && subtotal >= rate.freeOverAmount;
  return { rate, amount: free ? 0 : rate.amount };
}

// Region (province/state) tax overrides the market default when the market defines that region.
export function taxRateFor(market: { taxRateBps: number; regions: { code: string; taxRateBps: number }[] }, region?: string | null): number {
  const r = region && market.regions.find((x) => x.code.toUpperCase() === region.toUpperCase());
  return r ? r.taxRateBps : market.taxRateBps;
}

export type TaxComponent = { name: string; bps: number };

/** Split `tax` (minor units) across components in proportion to their rates; the rounding remainder goes to the largest parts so the lines add up exactly. */
export function splitTax(tax: number, components: TaxComponent[]): { name: string; amount: number }[] {
  const total = components.reduce((a, c) => a + c.bps, 0);
  if (!components.length || total <= 0 || tax <= 0) return [];
  const raw = components.map((c) => ({ name: c.name, exact: (tax * c.bps) / total }));
  const parts = raw.map((r) => ({ name: r.name, amount: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let left = tax - parts.reduce((a, p) => a + p.amount, 0);
  for (const p of [...parts].sort((a, b) => b.frac - a.frac)) { if (left <= 0) break; p.amount++; left--; }
  return parts.map(({ name, amount }) => ({ name, amount }));
}

/** JSON for Order.taxBreakdown: the region's components when it has them (Canada), else null so the receipt shows one tax line. */
export function taxBreakdownFor(market: { regions: { code: string; components?: string | null }[] }, region: string | null | undefined, tax: number): string | null {
  const r = region ? market.regions.find((x) => x.code.toUpperCase() === region.toUpperCase()) : undefined;
  if (!r?.components) return null;
  let comps: TaxComponent[] = [];
  try { comps = JSON.parse(r.components); } catch { return null; }
  const parts = splitTax(tax, comps);
  return parts.length ? JSON.stringify(parts) : null;
}
