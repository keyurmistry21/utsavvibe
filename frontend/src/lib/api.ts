export type ShippingRate = { id?: string; name: string; amount: number; freeOverAmount: number | null; minDays: number | null; maxDays: number | null };
export type Region = { code: string; name: string; taxRateBps: number };
export type Market = {
  regions: Region[];
  id: string; code: string; name: string; currency: string; countries: string[];
  taxRateBps: number; taxInclusive: boolean; active: boolean; shippingRates: ShippingRate[];
};
export type Price = { amount: number; compareAt?: number | null };
export type Variant = {
  id?: string; title: string; options: Record<string, string>; sku?: string | null;
  inventory: number; weightG: number; barcode?: string | null; costPerItem?: number | null; prices: Record<string, Price>;
};
export type ProductImage = { id: string; url: string; thumbUrl: string; alt: string; position: number; width: number; height: number };
export type Product = {
  images: ProductImage[];
  id: string; title: string; handle: string; description: string; status: "draft" | "active" | "archived"; vendor: string; productType: string;
  trackInventory: boolean; continueSelling: boolean; physical: boolean; chargeTax: boolean; isGiftCard?: boolean; seoTitle: string; seoDescription: string;
  tags: string[]; notes: string; marketIds: string[]; regions: Record<string, string[]>; variants: Variant[];
};
export type Order = {
  id: string; number: number; currency: string; subtotal: number; tax: number; shipping: number; total: number;
  status: string; paymentStatus: string; tags: string[]; notes: string; createdAt: string; shippingName: string;
  shippingAddress: Record<string, string>; items: { id: string; variantId: string | null; title: string; quantity: number; unitPrice: number; taxable: boolean; physical: boolean; weightG: number }[];
  customer: { id: string; email: string | null; name: string; phone?: string | null; taxExempt?: boolean } | null; market: Market;
  discount: number; discountNote: string | null; paymentMethod: string | null; paymentLinkUrl: string | null;
  giftCardAmount?: number; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null; packageWeightG: number | null; shippedAt: string | null;
};
export type Address = {
  country: string; firstName: string; lastName: string; company: string; line1: string; line2: string;
  city: string; region: string; postcode: string; phone: string;
};
export const blankAddress = (): Address => ({ country: "", firstName: "", lastName: "", company: "", line1: "", line2: "", city: "", region: "", postcode: "", phone: "" });
export const addressFrom = (a: Record<string, string | undefined> | null | undefined): Address => ({ ...blankAddress(), ...Object.fromEntries(Object.entries(a ?? {}).map(([k, v]) => [k, v ?? ""])) });
export const hasAddress = (a: Address) => !!(a.line1 || a.city || a.postcode);

export type Customer = {
  id: string; email: string | null; name: string; phone: string | null; tags: string[]; notes: string;
  language: string; acceptsEmail: boolean; acceptsSms: boolean; acceptsWhatsapp: boolean; taxExempt: boolean;
  address: Address | null;
  orderCount: number; spent: Record<string, number>;
};
export type CustHit = { id: string; name: string; email: string | null; phone: string | null; taxExempt: boolean; address: Record<string, string> | null };

export class UnauthorizedError extends Error {}

// Session lives in an httpOnly cookie set by the API; the browser sends it automatically (same origin via the Next proxy).
async function request<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/auth/login")) {
    window.dispatchEvent(new Event("admin:unauthorized"));
    throw new UnauthorizedError("Session expired");
  }
  if (!res.ok) throw new Error(data.error === "validation" ? data.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ") : data.error ?? res.statusText);
  return data as T;
}

export async function uploadImage(productId: string, file: File, alt = ""): Promise<ProductImage> {
  const res = await fetch(`/api/admin/products/${productId}/images`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": file.type || "application/octet-stream", "x-image-alt": encodeURIComponent(alt) },
    body: file,
  });
  if (res.status === 401) window.dispatchEvent(new Event("admin:unauthorized"));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

export const api = <T>(path: string, init?: RequestInit & { json?: unknown }) => request<T>(`/api/admin${path}`, init);
export const auth = <T>(path: string, init?: RequestInit & { json?: unknown }) => request<T>(`/api/auth${path}`, init);
export type AdminUser = { id: string; email: string; name: string; role: string | null; owner: boolean; permissions: string[] };

// minor units <-> display
export const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 100);
export const toMinor = (s: string) => Math.round(parseFloat(s || "0") * 100);
export const toMajor = (minor: number | undefined) => (minor == null ? "" : (minor / 100).toFixed(2));

export type CustomerRow = {
  id: string; name: string; firstName: string; lastName: string; email: string | null; phone: string | null; language: string;
  acceptsEmail: boolean; acceptsSms: boolean; acceptsWhatsapp: boolean; taxExempt: boolean;
  tags: string[]; notes: string; createdAt: string; updatedAt: string;
  location: string; postcode: string; orderCount: number; spent: Record<string, number>;
};

// Authenticated file download (CSV exports): fetch with the session cookie, then save the blob.
export async function download(path: string, fallbackName: string) {
  const res = await fetch(`/api/admin${path}`, { credentials: "same-origin" });
  if (res.status === 401) window.dispatchEvent(new Event("admin:unauthorized"));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ProductRow = {
  id: string; title: string; handle: string; status: "draft" | "active" | "archived"; vendor: string; productType: string;
  tags: string[]; createdAt: string; updatedAt: string; thumbUrl: string | null;
  inventory: number; variantCount: number; markets: string[]; prices: Record<string, { currency: string; min: number }>;
};
