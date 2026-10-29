// Storefront account helpers (client side). The session itself is an httpOnly cookie set by the API.
export type Me = { email: string | null; name: string; preferredMarket: string | null };

export async function getMe(): Promise<Me | null> {
  try {
    const r = await fetch("/api/store/account/me", { credentials: "same-origin", cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Remember the market on this device (guests) so "/" opens it next time. */
export const rememberMarket = (code: string) => {
  try { document.cookie = `uv_market=${code.toLowerCase()}; path=/; max-age=31536000; samesite=lax`; } catch {}
};

export async function accountCall<T>(path: string, method: "POST" | "PUT", body?: unknown): Promise<T> {
  const r = await fetch(`/api/store/account${path}`, { method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error === "validation" ? data.issues?.[0]?.message ?? "Please check the form" : data.error ?? "Something went wrong");
  return data as T;
}
