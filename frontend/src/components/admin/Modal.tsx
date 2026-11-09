"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function Modal({ title, onClose, children, footer, wide = false, dismissOnScrim = true }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; dismissOnScrim?: boolean }) {
  const [closing, setClosing] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // play the close transition (--modal-close-dur), then tell the parent
  const closingRef = useRef(false);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--modal-close-dur")) || 150;
    setTimeout(() => closeRef.current(), ms);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // no background scroll while open
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [close]);

  return (
    <div className={`modal-scrim${closing ? " is-closing" : ""}`} onMouseDown={(e) => dismissOnScrim && e.target === e.currentTarget && close()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="x" aria-label="Close" onClick={close}>✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
