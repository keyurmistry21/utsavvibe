"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { track } from "@/lib/track";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID; // e.g. G-XXXXXXXXXX; unset = Google Analytics off, our own tracking still runs

// Mounted once in the storefront layout: page views, product views, and active time per page.
export function Tracker() {
  const path = usePathname();
  const active = useRef({ ms: 0, since: 0 });

  useEffect(() => {
    const a = active.current;
    a.ms = 0; a.since = document.visibilityState === "visible" ? Date.now() : 0;
    const startedAt = path;
    // wait a tick so document.title has updated for the new route
    const t = setTimeout(() => {
      track("page_view");
      if (/\/products\//.test(startedAt)) track("view_item");
    }, 50);

    const pause = () => { if (a.since) { a.ms += Date.now() - a.since; a.since = 0; } };
    const resume = () => { if (!a.since && document.visibilityState === "visible") a.since = Date.now(); };
    const vis = () => (document.visibilityState === "hidden" ? pause() : resume());
    // Only active time counts: the tab must be visible and the person must have moved, scrolled or typed in the last 30 s.
    let last = Date.now();
    const poke = () => { if (!a.since && document.visibilityState === "visible") a.since = Date.now(); last = Date.now(); };
    const idle = setInterval(() => { if (Date.now() - last > 30_000) pause(); }, 5_000);
    const leave = () => { pause(); if (a.ms > 0) track("page_leave", { seconds: a.ms / 1000 }); a.ms = 0; };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", leave);
    for (const e of ["pointerdown", "scroll", "keydown", "touchstart"]) window.addEventListener(e, poke, { passive: true });
    return () => {
      clearTimeout(t); clearInterval(idle);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", leave);
      for (const e of ["pointerdown", "scroll", "keydown", "touchstart"]) window.removeEventListener(e, poke);
      leave(); // route change: record time on the page we are leaving
    };
  }, [path]);

  if (!GA_ID || !/^G-[A-Z0-9]+$/.test(GA_ID)) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${GA_ID}',{send_page_view:false,anonymize_ip:true});`}</Script>
    </>
  );
}
