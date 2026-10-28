"use client";

import { useEffect } from "react";

export function Modal({ title, onClose, children, footer, wide = false, dismissOnScrim = true }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; dismissOnScrim?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // no background scroll while open
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="modal-scrim" onMouseDown={(e) => dismissOnScrim && e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="x" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
