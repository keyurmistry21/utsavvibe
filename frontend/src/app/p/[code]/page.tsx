import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata = { title: "Find a product", robots: { index: false, follow: false } };

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:4000";

// Target of QR codes on labels: /p/<SKU or barcode> -> the product page with that variant highlighted.
export default async function Scan({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ market?: string }> }) {
  const { code } = await params;
  const { market } = await searchParams;
  const res = await fetch(`${BACKEND}/api/store/lookup/${encodeURIComponent(decodeURIComponent(code))}${market ? `?market=${encodeURIComponent(market)}` : ""}`, { cache: "no-store" }).catch(() => null);
  if (res?.ok) {
    const r = (await res.json()) as { market: string; handle: string; variantId: string };
    redirect(`/${r.market.toLowerCase()}/products/${r.handle}?variant=${r.variantId}`);
  }
  return (
    <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
      <h1>We couldn't find that product</h1>
      <p style={{ color: "#666" }}>The code <b>{decodeURIComponent(code)}</b> isn't on sale right now.</p>
      <Link href="/uk">Browse the shop</Link>
    </div>
  );
}
