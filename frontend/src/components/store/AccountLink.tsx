"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMe, type Me } from "./account";

export function AccountLink({ market }: { market: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => { void getMe().then(setMe); }, []);
  if (me === undefined) return null;
  return <Link href={`/${market}/account`} className="acctlink">{me ? (me.name.split(" ")[0] || "Account") : "Sign in"}</Link>;
}
