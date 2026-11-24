"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Slide = { image: string; alt: string; sub: string; title: [string, string]; text: string; button: string; href: string };

// Fading hero: arrows, dots, swipe, auto-advance that stops while the pointer is over it (and for people who prefer less motion).
export function HeroSlider({ slides, phone, phoneHref }: { slides: Slide[]; phone: string; phoneHref: string }) {
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const n = slides.length;
  const go = (d: number) => setI((c) => (c + d + n) % n);

  useEffect(() => {
    if (hold || n < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((c) => (c + 1) % n), 6000);
    return () => clearInterval(t);
  }, [hold, n]);

  let x0 = 0;
  return (
    <section className="th-hero" aria-roledescription="carousel" aria-label="Featured" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}
      onTouchStart={(e) => { x0 = e.touches[0].clientX; }} onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); }}>
      <div className="th-hero-slides">
        {slides.map((s, k) => (
          <div key={k} className={`th-hero-in th-slide ${k === i ? "on" : ""}`} role="group" aria-roledescription="slide" aria-label={`${k + 1} of ${n}`} aria-hidden={k !== i}>
            <div className="th-hero-copy">
              <p className="th-sub">{s.sub}</p>
              {k === 0 ? <h1 className="th-title"><span className="acc">{s.title[0]} </span><span>{s.title[1]}</span></h1> : <h2 className="th-title"><span className="acc">{s.title[0]} </span><span>{s.title[1]}</span></h2>}
              <p className="th-text">{s.text}</p>
              <div className="th-btns">
                <Link className="tbtn" href={s.href} tabIndex={k === i ? 0 : -1}>{s.button}</Link>
                <a className="tbtn ghost" href={phoneHref} tabIndex={k === i ? 0 : -1}>{phone}</a>
              </div>
            </div>
            <div className="th-hero-img"><img src={s.image} alt={s.alt} width={560} height={560} {...(k === 0 ? { fetchPriority: "high" as const } : { loading: "lazy" as const })} /></div>
          </div>
        ))}
      </div>
      {n > 1 && (
        <>
          <button type="button" className="th-arrow prev" aria-label="Previous slide" onClick={() => go(-1)}>‹</button>
          <button type="button" className="th-arrow next" aria-label="Next slide" onClick={() => go(1)}>›</button>
          <div className="th-dots" role="tablist" aria-label="Choose slide">
            {slides.map((_, k) => <button type="button" key={k} role="tab" aria-selected={k === i} aria-label={`Slide ${k + 1}`} className={k === i ? "on" : ""} onClick={() => setI(k)} />)}
          </div>
        </>
      )}
    </section>
  );
}
