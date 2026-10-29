"use client";

import { useState } from "react";

// Read-only text with a Copy button (feed URLs, one-time secrets).
export function CopyBox({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); } catch { /* clipboard blocked: the text can still be selected */ }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input readOnly aria-label={label} value={value} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }} />
      <button type="button" onClick={copy}>{done ? "Copied" : "Copy"}</button>
    </div>
  );
}
