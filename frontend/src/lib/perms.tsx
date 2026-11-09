"use client";

import { createContext, useContext } from "react";
import type { AdminUser } from "./api";

const Ctx = createContext<AdminUser | null>(null);
export const PermsProvider = Ctx.Provider;

/** `can("orders.view")`: owners can do everything, and `x.manage` includes `x.view`. The server enforces the same rules; this only hides what you can't use. */
export function useCan() {
  const u = useContext(Ctx);
  const can = (perm: string) => !!u && (u.owner || u.permissions.includes(perm) || (perm.endsWith(".view") && u.permissions.includes(perm.replace(/\.view$/, ".manage"))));
  return { can, user: u };
}

// which permission each admin area needs (first matching prefix wins)
export const ROUTE_PERMS: [string, string][] = [
  ["/admin/orders", "orders.view"],
  ["/admin/products/import", "products.manage"],
  ["/admin/products/scan", "products.manage"],
  ["/admin/products", "products.view"],
  ["/admin/collections", "products.view"],
  ["/admin/gift-cards", "gift_cards.view"],
  ["/admin/customers", "customers.view"],
  ["/admin/markets", "markets.manage"],
  ["/admin/expenses", "expenses.view"],
  ["/admin/analytics", "analytics.view"],
  ["/admin/online-store", "online_store.manage"],
  ["/admin/marketing", "integrations.manage"],
  ["/admin/settings/apps", "integrations.manage"],
  ["/admin/settings/checkout", "settings.manage"],
  ["/admin/settings/users", "users.manage"],
  ["/admin/settings/roles", "users.manage"],
  ["/admin/settings/payments", "settings.manage"],
  ["/admin/settings/locations", "settings.manage"],
  ["/admin/settings/policies", "settings.manage"],
  ["/admin/settings/general", "settings.manage"],
  ["/admin/settings/notifications", "settings.manage"],
];
