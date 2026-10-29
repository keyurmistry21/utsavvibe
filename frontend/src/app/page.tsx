import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMarkets } from "@/lib/store";

// "/" opens the shop this device used last (set by the header market switcher), else the UK.
// Visiting a market URL directly never changes the saved choice.
export default async function Home() {
  const want = (await cookies()).get("uv_market")?.value;
  const markets = await getMarkets().catch(() => []);
  const hit = markets.find((m) => m.code.toLowerCase() === want?.toLowerCase());
  redirect(`/${(hit ?? markets.find((m) => m.code === "UK") ?? markets[0])?.code.toLowerCase() ?? "uk"}`);
}
