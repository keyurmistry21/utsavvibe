// Cookie / tracking consent (PIPEDA, Quebec Law 25). "all" = third-party tools (Google Analytics, Meta Pixel) may load;
// "essential" = they never do. Our own anonymous visit counter stores no cookie and no personal data, so it is not gated.
export type Consent = "all" | "essential" | null;
const KEY = "uv_consent";

export function getConsent(): Consent {
  try { const v = localStorage.getItem(KEY); return v === "all" || v === "essential" ? v : null; } catch { return null; }
}
export function setConsent(v: "all" | "essential") {
  try { localStorage.setItem(KEY, v); } catch { /* private mode: the choice lasts until reload */ }
  window.dispatchEvent(new CustomEvent("uv:consent", { detail: v }));
}
export const reopenConsent = () => window.dispatchEvent(new CustomEvent("uv:consent-open"));
