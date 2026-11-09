"use client";

import { useCallback, useState } from "react";

// error state shake (transitions-dev): remove the class, force a reflow, add it back so the shake replays every time
export function shake(el: Element | null | undefined) {
  if (!el) return;
  el.classList.remove("is-shaking");
  void (el as HTMLElement).offsetWidth;
  el.classList.add("is-shaking");
  const cs = getComputedStyle(document.documentElement);
  const ms = (parseFloat(cs.getPropertyValue("--shake-dur-a")) || 80) * 2 + (parseFloat(cs.getPropertyValue("--shake-dur-b")) || 60) * 2;
  setTimeout(() => el.classList.remove("is-shaking"), ms + 20);
}

// A blur caused by pressing a button must not show its error until the click is over: the error line would push the
// button down mid-press and the click would be lost. Blurs during a press wait until just after pointerup.
let pressing = false;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => { pressing = true; }, true);
  document.addEventListener("pointerup", () => setTimeout(() => { pressing = false; }, 60), true);
  document.addEventListener("pointercancel", () => { pressing = false; }, true);
}

// Inline validation: a form computes `errors` (pure, from its state) every render; this hook decides when to SHOW them:
// after a field was touched (blurred) or after a submit attempt. Errors disappear as soon as the value is valid.
export function useValidation(errors: Record<string, string | undefined>) {
  const [touched, setTouched] = useState<Record<string, true>>({});
  const [submitted, setSubmitted] = useState(false);

  const err = (k: string) => ((submitted || touched[k]) && errors[k]) || "";
  const touch = useCallback((k: string) => {
    const mark = () => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
    if (pressing) setTimeout(mark, 120); else mark();
  }, []);
  // spread onto the control: marks it invalid for screen readers + the red style, and touches it on blur
  const props = (k: string) => ({
    onBlur: () => touch(k),
    "aria-invalid": err(k) ? (true as const) : undefined,
    "aria-describedby": err(k) ? `err-${k.replace(/[^a-z0-9]/gi, "-")}` : undefined,
  });
  // call on Save: shows every error, jumps to the first one; returns true when the form is valid
  const submit = () => {
    setSubmitted(true);
    const bad = Object.values(errors).some(Boolean);
    if (bad) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (!el) return;
        document.querySelectorAll('[aria-invalid="true"]').forEach(shake);
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        (el.matches("input,textarea,button,[contenteditable]") ? el : el.querySelector<HTMLElement>("input,textarea,[contenteditable]") ?? el).focus?.({ preventScroll: true });
      }));
    }
    return !bad;
  };
  const reset = () => { setTouched({}); setSubmitted(false); };
  return { err, props, touch, submit, reset, count: Object.values(errors).filter(Boolean).length };
}

export function FieldError({ k, msg, small }: { k: string; msg?: string; small?: boolean }) {
  if (!msg) return null;
  return (
    <div className={`ferr ${small ? "sm" : ""}`} id={`err-${k.replace(/[^a-z0-9]/gi, "-")}`} role="alert">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" /><path d="M10 6v5M10 14h.01" /></svg>
      <span>{msg}</span>
    </div>
  );
}
