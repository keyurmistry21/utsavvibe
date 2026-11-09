import { ProductPage } from "@/components/admin/ProductPage";

// Reached only for products whose URL handle equals a fixed page name (new, labels, import, scan, edit).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductPage id={id} />;
}
