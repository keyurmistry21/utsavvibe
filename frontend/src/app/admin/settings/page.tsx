"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCan } from "@/lib/perms";
import { settingsLinks } from "@/components/admin/nav";

// /admin/settings opens the first settings page this person is allowed to use
export default function Page() {
  const router = useRouter();
  const { can } = useCan();
  useEffect(() => { router.replace((settingsLinks.find((l) => can(l.perm)) ?? settingsLinks[settingsLinks.length - 1]).href); }, []);
  return null;
}
