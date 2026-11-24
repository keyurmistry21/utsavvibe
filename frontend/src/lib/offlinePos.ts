// Offline till: a downloaded catalogue to look items up without internet, and a queue of cash sales that sync when it returns.
// Everything lives in this browser (localStorage). The server re-prices and re-checks stock when a queued sale arrives, so an old price can't cheat the till.
import { api } from "./api";

export type CatItem = { variantId: string; title: string; variant: string; options: Record<string, string>; sku: string | null; codes: string[]; imageId: string | null; price: number; stock: number; tracked: boolean; canSell: boolean };
export type Catalog = { savedAt: string; market: { id: string; code: string; currency: string; name: string; taxInclusive: boolean }; locations: { id: string; name: string; isDefault: boolean }[]; items: CatItem[] };
export type QueuedSale = { clientRef: string; queuedAt: string; summary: string; body: Record<string, unknown>; error?: string };

const CAT = "uv_pos_catalog", Q = "uv_pos_queue";
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

export const newRef = () => `off${Date.now().toString(36)}${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, "0")).join("")}`.slice(0, 40);
/** A failed fetch (no connection) is a TypeError; a server answer, even an error, is not. */
export const isOffline = (e: unknown) => e instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine);

export const getCatalog = () => read<Catalog | null>(CAT, null);
export async function downloadCatalog(market?: string): Promise<Catalog> {
  const c = await api<Catalog>(`/pos/catalog${market ? `?market=${market}` : ""}`);
  write(CAT, c);
  return c;
}
export function findInCatalog(raw: string): CatItem | null {
  const cat = getCatalog();
  if (!cat) return null;
  const m = raw.match(/\/p\/([^/?#]+)/);
  const code = decodeURIComponent(m ? m[1] : raw).trim().toLowerCase();
  return cat.items.find((i) => i.codes.some((c) => c.toLowerCase() === code)) ?? null;
}

export const getQueue = () => read<QueuedSale[]>(Q, []);
export const queueSale = (s: QueuedSale) => write(Q, [...getQueue(), s]);
export const dropQueued = (ref: string) => write(Q, getQueue().filter((s) => s.clientRef !== ref));

/** Send queued sales one by one. A sale the server refuses (stock gone, bad data) stays in the list with the reason, for staff to settle. */
export async function flushQueue(): Promise<{ sent: number; failed: number; offline: boolean }> {
  let sent = 0, failed = 0;
  for (const s of getQueue()) {
    try {
      await api("/pos/sale", { method: "POST", json: s.body });
      dropQueued(s.clientRef); sent++;
    } catch (e) {
      if (isOffline(e)) return { sent, failed, offline: true };
      failed++;
      write(Q, getQueue().map((x) => (x.clientRef === s.clientRef ? { ...x, error: (e as Error).message } : x)));
    }
  }
  return { sent, failed, offline: false };
}
