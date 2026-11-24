"use client";

import { useEffect, useRef, useState } from "react";

// Announcement pop-up (set under Online Store > Preferences). Shown once per visitor until the text changes.
export function SitePopup({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const sig = `popup:${text.length}:${title}`;
  useEffect(() => {
    try { if (localStorage.getItem(sig)) return; } catch {}
    const t = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(t);
  }, [sig]);
  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  });
  const close = () => { setOpen(false); try { localStorage.setItem(sig, "1"); } catch {} };
  if (!open) return null;
  return (
    <div className="qv-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="site-popup" role="dialog" aria-modal="true" aria-label={title || "Announcement"} tabIndex={-1} ref={box}>
        <button type="button" className="qv-x" aria-label="Close" onClick={close}>×</button>
        {title && <h3>{title}</h3>}
        {text.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}
      </div>
    </div>
  );
}
