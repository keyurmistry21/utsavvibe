// Inventory rules shared by storefront, checkout, drafts and the Stripe webhook.
type Flags = { trackInventory: boolean; continueSelling: boolean };

// Can `qty` of a variant with `inventory` on hand be sold?
export const canSell = (p: Flags, inventory: number, qty = 1) => !p.trackInventory || p.continueSelling || inventory >= qty;
// Only tracked products have their on-hand count reduced when an order is paid (continue-selling may go negative).
export const shouldDecrement = (p: Pick<Flags, "trackInventory">) => p.trackInventory;
