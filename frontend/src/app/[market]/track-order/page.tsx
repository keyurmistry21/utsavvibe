import type { Metadata } from "next";
import Link from "next/link";
import { TrackOrder } from "@/components/store/TrackOrder";

export const metadata: Metadata = { title: "Track your order", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  return (
    <article className="sf-page">
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / Track order</p>
      <h1>Track your order</h1>
      <p className="muted">Enter your order number (in your confirmation email) and the email you used.</p>
      <TrackOrder />
    </article>
  );
}
