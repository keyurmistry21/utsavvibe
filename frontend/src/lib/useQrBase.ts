"use client";

import { useEffect, useState } from "react";

/** Address that QR codes point at: the "Public store URL" preference, else wherever the admin is open. `local` = a phone can't reach it. */
export function useQrBase() {
  const [base, setBase] = useState("");
  useEffect(() => {
    setBase(location.origin);
    fetch("/api/store/site").then((r) => (r.ok ? r.json() : null)).then((s) => s?.publicUrl && setBase(String(s.publicUrl).replace(/\/$/, ""))).catch(() => {});
  }, []);
  const local = /^https?:\/\/(localhost|127\.|0\.0\.0\.0)/.test(base);
  return { base, local };
}
