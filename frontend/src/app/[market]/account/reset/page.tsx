import type { Metadata } from "next";
import { ResetPassword } from "@/components/store/ResetPassword";

export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Reset({ params, searchParams }: { params: Promise<{ market: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { market } = await params;
  const q = await searchParams;
  return <ResetPassword market={market} c={q.c ?? ""} e={q.e ?? ""} t={q.t ?? ""} />;
}
