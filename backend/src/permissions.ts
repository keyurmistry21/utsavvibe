import { prisma, parseJson } from "./db.js";

// Every permission is "<area>.<action>". `manage` includes `view` for that area.
export const PERMISSION_GROUPS = [
  { group: "Orders", items: [["orders.view", "View orders and draft orders"], ["orders.manage", "Create drafts, take payment, fulfil, cancel, edit tracking"]] },
  { group: "Products", items: [["products.view", "View products and stock"], ["products.manage", "Create, edit, delete products, prices, images, barcodes"]] },
  { group: "Customers", items: [["customers.view", "View customers"], ["customers.manage", "Create, edit, import, export customers"]] },
  { group: "Gift cards", items: [["gift_cards.view", "View gift cards and balances"], ["gift_cards.manage", "Issue, adjust and disable gift cards"]] },
  { group: "Analytics", items: [["analytics.view", "View sales reports and the dashboard"]] },
  { group: "Markets", items: [["markets.manage", "Manage markets, tax rates and shipping rates"]] },
  { group: "Online store", items: [["online_store.manage", "Manage pages, menus and storefront preferences"]] },
  { group: "Settings", items: [["settings.manage", "Ship-from address, email and store settings"]] },
  { group: "Staff", items: [["users.manage", "Add and remove staff, reset passwords, manage roles"]] },
] as const;

export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i[0]));
const VALID = new Set(ALL_PERMISSIONS);
export const validPermissions = (p: string[]) => p.every((x) => VALID.has(x));

export const OWNER = "Owner";

const DEFAULT_ROLES: { name: string; description: string; permissions: string[] }[] = [
  { name: "Administrator", description: "Everything except managing staff and roles.", permissions: ALL_PERMISSIONS.filter((p) => p !== "users.manage") },
  { name: "Fulfilment", description: "Pick, pack and ship orders.", permissions: ["orders.view", "orders.manage", "customers.view", "products.view"] },
  { name: "Catalog manager", description: "Products, prices, stock and barcodes.", permissions: ["products.view", "products.manage"] },
  { name: "Content editor", description: "Online store pages and menus only.", permissions: ["online_store.manage"] },
  { name: "Support", description: "Look up orders and look after customers.", permissions: ["orders.view", "customers.view", "customers.manage", "products.view"] },
];

type RoleLike = { name: string; isSystem: boolean; permissions: string } | null | undefined;
export type Perms = { owner: boolean; set: Set<string> };

export function permsOf(role: RoleLike): Perms {
  if (!role) return { owner: false, set: new Set() };
  if (role.isSystem && role.name === OWNER) return { owner: true, set: new Set(ALL_PERMISSIONS) };
  return { owner: false, set: new Set(parseJson<string[]>(role.permissions, []).filter((p) => VALID.has(p))) };
}

/** `manage` implies `view`. */
export function has(p: Perms, perm: string) {
  if (p.owner || p.set.has(perm)) return true;
  return perm.endsWith(".view") && p.set.has(perm.replace(/\.view$/, ".manage"));
}

/** Run on startup. Never overwrites roles an owner has edited, except the locked Owner role. Pre-existing admins become Owners. */
export async function ensureRoles() {
  await prisma.role.upsert({
    where: { name: OWNER },
    create: { name: OWNER, description: "Full access. Cannot be changed.", permissions: JSON.stringify(ALL_PERMISSIONS), isSystem: true },
    update: { permissions: JSON.stringify(ALL_PERMISSIONS), isSystem: true },
  });
  for (const r of DEFAULT_ROLES) {
    if (!(await prisma.role.findUnique({ where: { name: r.name } }))) await prisma.role.create({ data: { name: r.name, description: r.description, permissions: JSON.stringify(r.permissions) } });
  }
  const owner = await prisma.role.findUniqueOrThrow({ where: { name: OWNER } });
  await prisma.adminUser.updateMany({ where: { roleId: null }, data: { roleId: owner.id } });
}
