"use client";

import { use } from "react";
import { DraftEditor } from "@/components/admin/DraftEditor";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DraftEditor id={id} />;
}
