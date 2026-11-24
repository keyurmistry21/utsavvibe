import Link from "next/link";
import { ClearCart } from "@/components/store/ClearCart";

export const metadata = { title: "Order confirmed | UtsavVibe", robots: { index: false, follow: false } };

export default async function OrderDone({ params }: { params: Promise<{ market: string; number: string }> }) {
  const { market, number } = await params;
  return (
    <div className="card">
      <ClearCart order={number} />
      <h1>Thank you!</h1>
      <p>Order <b>#{number}</b> received. A confirmation is on its way once payment clears.</p>
      <Link href={`/${market}`}>Continue shopping</Link>
    </div>
  );
}
