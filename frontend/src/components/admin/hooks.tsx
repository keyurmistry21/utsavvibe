"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    api<T>(path).then(setData).catch((e) => setError(e.message));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

export const TagList = ({ tags }: { tags: string[] }) => <>{tags.map((t) => <span key={t} className="chip">{t}</span>)}</>;

const tone: Record<string, string> = {
  active: "good", paid: "good", fulfilled: "good",
  draft: "", open: "warn", pending: "warn",
  cancelled: "bad", failed: "bad", refunded: "bad", archived: "", sent: "good", skipped: "warn",
};
export const Badge = ({ value }: { value: string }) => <span className={`badge ${tone[value] ?? ""}`}>{value}</span>;
