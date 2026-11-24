import type { Metadata } from "next";
import Link from "next/link";
import { Account } from "@/components/store/Account";

export const metadata: Metadata = { title: "My account", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  return (
    <article className="sf-page">
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / Account</p>
      <h1>My account</h1>
      <Account market={market} />
    </article>
  );
}
