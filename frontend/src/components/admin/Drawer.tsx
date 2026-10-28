"use client";

import { useEffect } from "react";

// Right-hand slide-over panel (for longer forms that shouldn't hide the page behind them).
export function Drawer({ title, onClose, children, footer, dismissOnScrim = true }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  dismissOnScrim?: boolean;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="drawer-scrim" onMouseDown={(e) => dismissOnScrim && e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head"><h3>{title}</h3><button className="x" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}
