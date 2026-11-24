// Storefront visitor tracking (doc §8). Anonymous: a random per-visit id in sessionStorage, no cookies, no IP stored.
// Events go to our own API (admin "Sales insights and traffic") and, when NEXT_PUBLIC_GA_ID is set, to Google Analytics 4.
export type TrackType = "page_view" | "view_item" | "add_to_cart" | "begin_checkout" | "purchase" | "page_leave";
type Attr = { source: string; medium: string; campaign: string };
type Gtag = (...a: unknown[]) => void;

const ss = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
};

function sessionId() {
  let id = ss.get("uv_sid");
  if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join(""); ss.set("uv_sid", id); }
  return id;
}

// Where the visit came from: UTM tags win (Instagram bio links, ads), then the referring site, else direct.
function attribution(): Attr {
  const saved = ss.get("uv_attr");
  if (saved) { try { return JSON.parse(saved) as Attr; } catch { /* recompute */ } }
  const q = new URLSearchParams(location.search);
  let a: Attr = { source: "direct", medium: "", campaign: "" };
  const us = q.get("utm_source");
  if (us) a = { source: us.slice(0, 100), medium: (q.get("utm_medium") ?? "").slice(0, 100), campaign: (q.get("utm_campaign") ?? "").slice(0, 100) };
  else if (document.referrer) {
    try {
      const h = new URL(document.referrer).hostname.replace(/^(www|m|l)\./, "");
      if (h !== location.hostname.replace(/^www\./, "")) {
        const known: [RegExp, string, string][] = [[/instagram\./, "instagram", "social"], [/(facebook|fb)\./, "facebook", "social"], [/google\./, "google", "organic"], [/bing\./, "bing", "organic"], [/(youtube|youtu)\./, "youtube", "social"], [/(whatsapp|wa\.me)/, "whatsapp", "social"]];
        const hit = known.find(([re]) => re.test(h));
        a = hit ? { source: hit[1], medium: hit[2], campaign: "" } : { source: h.slice(0, 100), medium: "referral", campaign: "" };
      }
    } catch { /* bad referrer */ }
  }
  ss.set("uv_attr", JSON.stringify(a));
  return a;
}

function marketOf(path: string) { return /^\/(uk|us|ca)(\/|$)/i.test(path) ? path.split("/")[1].toUpperCase() : ""; }

export function track(type: TrackType, extra: { seconds?: number; data?: Record<string, unknown> } = {}) {
  if (typeof window === "undefined") return;
  const path = location.pathname;
  const a = attribution();
  const body = JSON.stringify({ sid: sessionId(), type, path, title: document.title.slice(0, 190), market: marketOf(path), ...a, ...(extra.seconds != null ? { seconds: Math.round(extra.seconds) } : {}) });
  try { fetch("/api/store/track", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {}); } catch { /* never break the page */ }
  const gt = (window as unknown as { gtag?: Gtag }).gtag;
  if (gt && type !== "page_leave") gt("event", type, { ...extra.data, page_path: path });
  // Meta Pixel (only present when the visitor accepted): same funnel under Meta's standard event names
  const fb = (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq;
  const META: Partial<Record<TrackType, string>> = { view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase" };
  if (fb && META[type]) fb("track", META[type], { currency: extra.data?.currency, value: extra.data?.value }, type === "purchase" && extra.data?.transaction_id ? { eventID: `order-${extra.data.transaction_id}` } : undefined);
}
