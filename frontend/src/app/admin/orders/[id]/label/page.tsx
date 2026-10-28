"use client";

import { use } from "react";
import { Label } from "@/components/admin/Label";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Label id={id} />;
}
