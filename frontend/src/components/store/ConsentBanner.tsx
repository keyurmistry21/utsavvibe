"use client";

import { useEffect, useState } from "react";
import { getConsent, setConsent } from "@/lib/consent";

// Shown until the visitor chooses; the footer "Cookie settings" link reopens it.
export function ConsentBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(getConsent() === null);
    const reopen = () => setOpen(true);
    window.addEventListener("uv:consent-open", reopen);
    return () => window.removeEventListener("uv:consent-open", reopen);
  }, []);
  if (!open) return null;
  const choose = (v: "all" | "essential") => { setConsent(v); setOpen(false); };
  return (
    <div className="consent-bar" role="dialog" aria-label="Cookie preferences" aria-live="polite">
      <p>
        We use cookies and similar tools to run the shop and, with your OK, to understand which pages help you and to measure our ads (Google Analytics and Meta). We always count visits anonymously, without personal details. You can change your mind any time under “Cookie settings”.
      </p>
      <div className="consent-actions">
        <button className="consent-secondary" onClick={() => choose("essential")}>Essential only</button>
        <button className="consent-primary" onClick={() => choose("all")}>Accept all</button>
      </div>
    </div>
  );
}

export function CookieSettingsLink() {
  return <button type="button" className="linklike" onClick={() => window.dispatchEvent(new CustomEvent("uv:consent-open"))}>Cookie settings</button>;
}
