"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, auth, type AdminUser, type Market } from "./api";

type Ctx = { market: string | null; markets: Pick<Market, "code" | "name" | "currency">[]; allowed: string[] | null; setMarket: (code: string | null) => void };
const C = createContext<Ctx>({ market: null, markets: [], allowed: null, setMarket: () => {} });
export const useAdminMarket = () => useContext(C);

/**
 * The market this staff member works in (their default, saved on their account so it follows them to every device).
 * null = all markets. Products, orders and sales figures show only that market; the header menu switches it.
 */
export function AdminMarketProvider({ user, children }: { user: AdminUser; children: React.ReactNode }) {
  const allowed = user.allowedMarkets?.length ? user.allowedMarkets : null; // set by an admin; null = all markets
  const [markets, setMarkets] = useState<Ctx["markets"]>([]);
  const [market, setLocal] = useState<string | null>(user.preferredMarket ?? null);
  useEffect(() => { api<Market[]>("/markets").then((m) => setMarkets(m.filter((x) => x.active && (!allowed || allowed.includes(x.code))))).catch(() => {}); }, []);
  // a market that was switched off since: fall back to all
  const fallback = allowed ? markets[0]?.code ?? allowed[0] : null; // restricted staff always work in one of their markets
  const effective = market && markets.length && !markets.some((m) => m.code === market) ? fallback : market ?? fallback;
  const setMarket = useCallback((code: string | null) => {
    if (allowed && (!code || !allowed.includes(code))) return; // the server refuses it too
    setLocal(code);
    auth("/preferences", { method: "PUT", json: { preferredMarket: code } }).catch(() => {});
  }, [allowed]);
  return <C.Provider value={{ market: effective, markets, allowed, setMarket }}>{children}</C.Provider>;
}
