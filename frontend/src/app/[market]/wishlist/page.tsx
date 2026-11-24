import { WishlistPage } from "@/components/store/WishlistPage";

export const metadata = { title: "Wishlist", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  return <WishlistPage market={market} />;
}
