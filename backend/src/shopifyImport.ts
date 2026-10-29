import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { prisma } from "./db.js";
import { normalizeHandle, sanitizeDescription } from "./html.js";
import { processImage } from "./images.js";
import { saveFile } from "./storage.js";

// ---- CSV ----
/** RFC 4180: quoted cells may hold commas, quotes ("") and line breaks. Strips a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}

// ---- parsed shape ----
export type ParsedVariant = { options: Record<string, string>; title: string; sku: string | null; barcode: string | null; grams: number; inventory: number; price: string; compareAt: string; cost: string; cols: Record<string, string> };
export type ParsedProduct = {
  handle: string; title: string; descriptionHtml: string; vendor: string; productType: string; tags: string[]; status: "active" | "draft" | "archived";
  trackInventory: boolean; continueSelling: boolean; physical: boolean; chargeTax: boolean; giftCard: boolean; seoTitle: string; seoDescription: string;
  variants: ParsedVariant[]; images: { src: string; alt: string; position: number }[];
};
export type Parsed = { products: ParsedProduct[]; priceColumns: string[]; skipped: number };

const truthy = (s: string) => /^(true|yes|1)$/i.test(s.trim());

export function parseShopify(text: string): Parsed {
  const rows = parseCsv(text);
  if (rows.length < 2) throw Object.assign(new Error("That file has no product rows"), { status: 400 });
  const head = rows[0].map((h) => h.trim());
  const idx = (name: string) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  if (idx("Handle") < 0 || idx("Title") < 0) throw Object.assign(new Error("This doesn't look like a Shopify product export (no Handle and Title columns). In Shopify: Products → Export → All products → CSV for Excel, numbers, or similar programs."), { status: 400 });
  const col = (r: string[], name: string) => { const i = idx(name); return i < 0 ? "" : (r[i] ?? "").trim(); };
  const priceColumns = head.filter((h) => /^price \/ /i.test(h));

  const by = new Map<string, ParsedProduct>();
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const handle = normalizeHandle(col(r, "Handle"));
    if (!handle) { skipped++; continue; }
    let p = by.get(handle);
    if (!p) {
      const status = col(r, "Status").toLowerCase();
      p = {
        handle, title: col(r, "Title"), descriptionHtml: (r[idx("Body (HTML)")] ?? "").trim(), vendor: col(r, "Vendor"), productType: col(r, "Type"),
        tags: col(r, "Tags").split(",").map((t) => t.trim()).filter(Boolean),
        status: status === "active" || status === "draft" || status === "archived" ? status : idx("Published") >= 0 && !truthy(col(r, "Published")) ? "draft" : "active",
        trackInventory: col(r, "Variant Inventory Tracker") !== "", continueSelling: col(r, "Variant Inventory Policy").toLowerCase() === "continue",
        physical: idx("Variant Requires Shipping") < 0 ? true : truthy(col(r, "Variant Requires Shipping")), chargeTax: idx("Variant Taxable") < 0 ? true : truthy(col(r, "Variant Taxable")),
        giftCard: truthy(col(r, "Gift Card")), seoTitle: col(r, "SEO Title"), seoDescription: col(r, "SEO Description"), variants: [], images: [],
      };
      by.set(handle, p);
    }
    const src = col(r, "Image Src");
    if (src) p.images.push({ src, alt: col(r, "Image Alt Text"), position: parseInt(col(r, "Image Position")) || p.images.length + 1 });
    // a row is a variant when it carries option/price/sku data; otherwise it only adds an image
    const optNames = [1, 2, 3].map((n) => col(r, `Option${n} Name`));
    const optVals = [1, 2, 3].map((n) => col(r, `Option${n} Value`));
    const hasVariant = optVals.some(Boolean) || col(r, "Variant Price") || col(r, "Variant SKU") || p.variants.length === 0;
    if (!hasVariant) continue;
    const firstRow = p.variants.length === 0;
    const names = firstRow ? optNames : p.variants[0].cols.__names.split("\u0001");
    const options: Record<string, string> = {};
    optVals.forEach((v, i) => { if (v && names[i] && !(names[i] === "Title" && v === "Default Title")) options[names[i]] = v; });
    const cols: Record<string, string> = { __names: optNames.join("\u0001") };
    if (!firstRow) cols.__names = p.variants[0].cols.__names;
    for (const h of priceColumns) cols[h] = col(r, h);
    for (const h of head.filter((x) => /^compare at price \/ /i.test(x))) cols[h] = col(r, h);
    p.variants.push({
      options, title: Object.values(options).join(" / ") || "Default", sku: col(r, "Variant SKU") || null, barcode: col(r, "Variant Barcode").replace(/^'/, "") || null,
      grams: Math.max(0, Math.round(parseFloat(col(r, "Variant Grams")) || 0)), inventory: Math.max(0, parseInt(col(r, "Variant Inventory Qty")) || 0),
      price: col(r, "Variant Price"), compareAt: col(r, "Variant Compare At Price"), cost: col(r, "Cost per item"), cols,
    });
  }
  return { products: [...by.values()], priceColumns, skipped };
}

// ---- prices ----
export const toMinor = (s: string): number | null => {
  const t = s.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  if (!t) return null;
  const n = Math.round(parseFloat(t) * 100);
  return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? n : null;
};

/** Which column of the CSV supplies a market's price: "base" = Variant Price, or the exact "Price / Country" header. */
export type PriceSource = "base" | string;
export function variantPrice(v: ParsedVariant, source: PriceSource): { amount: number | null; compareAt: number | null } {
  const price = source === "base" ? v.price : v.cols[source] ?? "";
  // Shopify names the matching compare-at column "Compare At Price / <market>"; without one, the plain compare-at price still applies
  const cmpKey = Object.keys(v.cols).find((k) => source !== "base" && k.toLowerCase() === source.replace(/^price /i, "compare at price ").toLowerCase());
  const cmp = source === "base" ? v.compareAt : cmpKey ? v.cols[cmpKey] : v.compareAt;
  const amount = toMinor(price);
  const compareAt = toMinor(cmp);
  return { amount, compareAt: amount != null && compareAt != null && compareAt > amount ? compareAt : null };
}

// ---- parse sessions (kept in memory so a big file is uploaded once, then imported in small batches) ----
const sessions = new Map<string, { at: number; parsed: Parsed; userId: string }>();
const TTL = 60 * 60_000;
export function keepParsed(parsed: Parsed, userId: string) {
  for (const [k, s] of sessions) if (Date.now() - s.at > TTL) sessions.delete(k);
  if (sessions.size > 20) sessions.delete(sessions.keys().next().value!);
  const token = randomUUID();
  sessions.set(token, { at: Date.now(), parsed, userId });
  return token;
}
export function takeParsed(token: string, userId: string) {
  const s = sessions.get(token);
  if (!s || s.userId !== userId || Date.now() - s.at > TTL) throw Object.assign(new Error("This import expired. Upload the file again."), { status: 410 });
  return s.parsed;
}

// ---- images ----
// Only Shopify's own CDN, and only addresses that resolve to the public internet: an import must never make the server fetch internal URLs.
const IMAGE_HOSTS = [/^cdn\.shopify\.com$/i, /^[a-z0-9-]+\.myshopify\.com$/i, /^cdn\.shopifycdn\.net$/i, /\.shopifycdn\.com$/i];
const privateIp = (ip: string) => {
  if (net.isIPv6(ip)) return /^(::1?|f[cd]|fe[89ab]|::ffff:(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 100 && b >= 64 && b <= 127);
};
export async function fetchImage(src: string): Promise<Buffer> {
  const u = new URL(src);
  if (u.protocol !== "https:" || u.port || !IMAGE_HOSTS.some((re) => re.test(u.hostname))) throw new Error("image host not allowed (only Shopify's CDN)");
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error("image host resolves to a private address");
  const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`image download failed (${r.status})`);
  if (Number(r.headers.get("content-length") ?? 0) > 12_000_000) throw new Error("image too large");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 12_000_000) throw new Error("image too large");
  return buf;
}

// ---- import one product ----
export type ImportOptions = { markets: { marketId: string; source: PriceSource }[]; images: boolean };
export type ImportResult = { handle: string; status: "created" | "skipped" | "failed"; message: string; warnings: string[] };

export async function importProduct(p: ParsedProduct, o: ImportOptions): Promise<ImportResult> {
  const warnings: string[] = [];
  const done = (status: ImportResult["status"], message = "") => ({ handle: p.handle, status, message, warnings });
  if (!p.title) return done("failed", "no title");
  if (await prisma.product.findUnique({ where: { handle: p.handle }, select: { id: true } })) return done("skipped", "a product with this URL handle already exists");
  if (!p.variants.length) return done("failed", "no variants");

  const usedSkus = new Set<string>();
  const taken = new Set((await prisma.variant.findMany({ where: { sku: { in: p.variants.map((v) => v.sku).filter((x): x is string => !!x) } }, select: { sku: true } })).map((v) => (v.sku ?? "").toLowerCase()));
  const variants: any[] = [];
  for (const v of p.variants) {
    const prices = [];
    for (const m of o.markets) {
      const x = variantPrice(v, m.source);
      if (x.amount == null) return done("failed", `variant "${v.title}" has no price in the column chosen for one of your markets`);
      prices.push({ marketId: m.marketId, amount: x.amount, compareAt: x.compareAt });
    }
    let sku = v.sku;
    if (sku && (taken.has(sku.toLowerCase()) || usedSkus.has(sku.toLowerCase()))) { warnings.push(`SKU ${sku} is already used, left blank`); sku = null; }
    if (sku) usedSkus.add(sku.toLowerCase());
    const cost = toMinor(v.cost);
    variants.push({ title: v.title, options: JSON.stringify(v.options), sku, barcode: v.barcode, inventory: v.inventory, weightG: v.grams, costPerItem: cost, prices: { create: prices } });
  }
  const gift = p.giftCard;
  const created = await prisma.product.create({
    data: {
      title: p.title.slice(0, 255), handle: p.handle, description: sanitizeDescription(p.descriptionHtml), status: p.status, vendor: p.vendor.slice(0, 120), productType: p.productType.slice(0, 120),
      trackInventory: gift ? false : p.trackInventory, continueSelling: p.continueSelling, physical: gift ? false : p.physical, chargeTax: gift ? false : p.chargeTax, isGiftCard: gift,
      seoTitle: p.seoTitle.slice(0, 70), seoDescription: p.seoDescription.slice(0, 320) || null, tags: JSON.stringify(p.tags), notes: "Imported from Shopify",
      markets: { create: o.markets.map((m) => ({ marketId: m.marketId })) },
      variants: { create: variants },
    },
  });
  if (o.images) {
    const imgs = [...p.images].sort((a, b) => a.position - b.position).filter((x, i, arr) => arr.findIndex((y) => y.src === x.src) === i).slice(0, 10);
    let position = 0;
    for (const im of imgs) {
      try {
        const out = await processImage(await fetchImage(im.src));
        const row = await prisma.productImage.create({ data: { productId: created.id, alt: im.alt.slice(0, 190), position, width: out.width, height: out.height } });
        try { await saveFile(`${row.id}.webp`, out.full); await saveFile(`${row.id}-thumb.webp`, out.thumb); } catch (e) { await prisma.productImage.delete({ where: { id: row.id } }); throw e; }
        position++;
      } catch (e) {
        warnings.push(`image ${im.position}: ${(e as Error).message}`);
      }
    }
  }
  return done("created");
}
