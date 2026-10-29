import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMarkets } from "@/lib/store";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:4000";

// "/" opens the shop the visitor last chose: their account's preferred market if signed in, else the one remembered on
// this device, else the first market. Visiting a market URL directly never changes the saved choice.
export default async function Home() {
  const jar = await cookies();
  let want = jar.get("uv_market")?.value;
  const session = jar.get("uv_customer")?.value;
  if (session) {
    try {
      const r = await fetch(`${BACKEND}/api/store/account/me`, { headers: { cookie: `uv_customer=${session}` }, cache: "no-store" });
      if (r.ok) want = ((await r.json()) as { preferredMarket: string | null }).preferredMarket ?? want;
    } catch {}
  }
  const markets = await getMarkets().catch(() => []);
  const hit = markets.find((m) => m.code.toLowerCase() === want?.toLowerCase());
  redirect(`/${(hit ?? markets.find((m) => m.code === "UK") ?? markets[0])?.code.toLowerCase() ?? "uk"}`);
}
