import type { Metadata } from "next";
import { getMarkets } from "@/lib/store";
import { AccountPage } from "@/components/store/AccountPage";

export const metadata: Metadata = { title: "Account", robots: { index: false, follow: false } };

export default async function Account({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  const markets = (await getMarkets()).map((m) => ({ code: m.code, name: m.name, currency: m.currency }));
  return <AccountPage market={market} markets={markets} />;
}
