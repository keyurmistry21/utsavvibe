import { notFound } from "next/navigation";
import { CartPage } from "@/components/store/CartPage";
import { getMarkets } from "@/lib/store";

export const metadata = { title: "Cart | UtsavVibe", robots: { index: false, follow: false } };

export default async function Cart({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  const m = (await getMarkets()).find((x) => x.code.toLowerCase() === market.toLowerCase());
  if (!m) notFound();
  // Each market currently ships to its listed countries; first is used as the delivery country.
  return <CartPage market={market} country={m.countries[0]} regions={m.regions} />;
}
