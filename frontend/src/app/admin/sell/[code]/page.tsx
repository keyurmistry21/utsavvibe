import { Sell } from "@/components/admin/Sell";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <Sell code={decodeURIComponent(code)} />;
}
