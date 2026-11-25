"use client";

import { useEffect, useRef, useState } from "react";
import type { ToastDetail } from "@/lib/toast";

type Item = ToastDetail & { at: number };

// Bottom-centre stack. A success toast arriving right after another one replaces its text: the page's specific message
// ("Product saved") wins over the generic one the API helper shows ("Saved").
export function ToastHost() {
  const [items, setItems] = useState<Item[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const close = (id: number) => { clearTimeout(timers.current.get(id)); timers.current.delete(id); setItems((c) => c.filter((x) => x.id !== id)); };
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<ToastDetail>).detail;
      const now = Date.now();
      setItems((cur) => {
        const last = cur[cur.length - 1];
        if (t.kind === "success" && last && last.kind === "success" && now - last.at < 800) {
          clearTimeout(timers.current.get(last.id)); timers.current.delete(last.id);
          timers.current.set(t.id, setTimeout(() => close(t.id), 3500));
          return [...cur.slice(0, -1), { ...t, at: now }];
        }
        timers.current.set(t.id, setTimeout(() => close(t.id), t.kind === "error" ? 7000 : 3500));
        return [...cur.slice(-3), { ...t, at: now }];
      });
    };
    window.addEventListener("uv:toast", on);
    return () => window.removeEventListener("uv:toast", on);
  }, []);

  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <span className="toast-ic" aria-hidden>{t.kind === "success" ? "✓" : t.kind === "error" ? "!" : "i"}</span>
          <span className="toast-msg">{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => close(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
