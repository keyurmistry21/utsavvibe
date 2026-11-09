"use client";

import { useEffect, useRef } from "react";

// Search box with a clear (x) button. Clearing plays the transitions-dev "input clear with dissolve": the typed text
// flies down and blurs out, a soft streak lights under each word, and the placeholder falls back in.
// Timing reads the --clear-* / --glow-* tokens from :root at the start of every clear.
const num = (name: string, fb: number) => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return Number.isFinite(v) ? v : fb; };

function bezier(str: string) {
  const m = str.match(/cubic-bezier\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/);
  if (!m) return (t: number) => t;
  const [x1, y1, x2, y2] = m.slice(1).map(parseFloat);
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const dx = ((ax * s + bx) * s + cx) * s - t, d = (3 * ax * s + 2 * bx) * s + cx;
      if (Math.abs(dx) < 1e-6 || d === 0) break;
      s -= dx / d;
    }
    return ((ay * s + by) * s + cy) * s;
  };
}

export function SearchField({ value, onChange, placeholder, className = "", autoFocus, ...aria }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const phold = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const clearing = useRef(false);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const buildGlow = (text: string) => {
    const el = input.current!, w = wrap.current!.clientWidth || 280;
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = getComputedStyle(el).font;
    const padLeft = parseFloat(getComputedStyle(el).paddingLeft) || 12, spread = num("--glow-spread", 1.5);
    const layers: string[] = [];
    let x = 0;
    text.split(/(\s+)/).forEach((seg) => {
      const sw = ctx.measureText(seg).width;
      if (seg.trim()) {
        const cx = padLeft + x + sw / 2, hw = Math.max(sw * 0.45, 8) * spread;
        ([[0, 0.8, 7, 0.22], [hw * 0.45, 0.55, 8, 0.18], [-hw * 0.4, 0.65, 6, 0.16], [hw * 0.15, 0.9, 5, 0.14]] as const).forEach(([dx, rwm, rh, a]) => {
          layers.push(`radial-gradient(ellipse ${Math.max(hw * rwm, 2).toFixed(1)}px ${rh}px at ${(((cx + dx) / w) * 100).toFixed(2)}% 100%, rgba(0,0,0,${a}), transparent)`);
        });
      }
      x += sw;
    });
    return layers.join(", ");
  };

  const clear = () => {
    const text = value;
    if (clearing.current || !text) return;
    const w = wrap.current!, m = mirror.current!, p = phold.current!, g = glow.current!, inp = input.current!;
    clearing.current = true;
    const keepFocus = document.activeElement === inp;
    const cs = getComputedStyle(document.documentElement);
    const total = num("--clear-dur", 1000), outDur = num("--clear-out-dur", 400), inDur = num("--clear-in-dur", 400);
    const outFly = num("--clear-out-fly", 12), inFly = num("--clear-in-fly", 12), blur = num("--clear-blur", 2);
    const delay = num("--glow-delay", 50), peakAt = num("--glow-peak-at", 0.15), gOp = num("--glow-opacity", 0.42);
    const easeOut = bezier(cs.getPropertyValue("--clear-out-ease")), easeIn = bezier(cs.getPropertyValue("--clear-in-ease"));

    m.textContent = text.replace(/ /g, " ");
    g.style.background = buildGlow(text);
    w.classList.add("is-clearing");
    onChange("");
    p.style.cssText = `transform: translateY(-${inFly}px); opacity: .9; filter: blur(${blur}px)`;

    const t0 = performance.now();
    const tick = (now: number) => {
      const el = now - t0;
      const eo = easeOut(Math.min(1, el / outDur));
      m.style.cssText = `transform: translateY(${(eo * outFly).toFixed(1)}px); opacity: ${(1 - eo).toFixed(3)}; filter: blur(${(eo * blur).toFixed(1)}px)`;
      const ei = easeIn(Math.min(1, el / inDur));
      p.style.cssText = `transform: translateY(${(-inFly + ei * inFly).toFixed(1)}px); opacity: ${(0.9 + ei * 0.1).toFixed(3)}; filter: blur(${(blur - ei * blur).toFixed(1)}px)`;
      let gl = 0;
      if (el > delay) { const gp = Math.min(1, (el - delay) / Math.max(1, total - delay)); gl = gp < peakAt ? gp / peakAt : 1 - (gp - peakAt) / (1 - peakAt); }
      g.style.opacity = (gl * gOp).toFixed(3);
      if (el < total) { raf.current = requestAnimationFrame(tick); return; }
      w.classList.remove("is-clearing");
      m.style.cssText = ""; p.style.cssText = ""; m.textContent = ""; g.style.opacity = "0"; g.style.background = "";
      clearing.current = false;
      if (keepFocus) inp.focus({ preventScroll: true });
    };
    raf.current = requestAnimationFrame(tick);
  };

  return (
    <div ref={wrap} className={`searchfield t-clear ${value ? "has-value" : ""} ${className}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" /></svg>
      <input ref={input} autoFocus={autoFocus} placeholder={placeholder} value={value} aria-label={aria["aria-label"] ?? placeholder} onChange={(e) => onChange(e.target.value)} />
      <div ref={mirror} className="t-clear-mirror" aria-hidden="true" />
      <div ref={phold} className="t-clear-placeholder" aria-hidden="true">{placeholder}</div>
      <div ref={glow} className="t-clear-glow" aria-hidden="true" />
      <button type="button" className="t-clear-btn" aria-label="Clear search" tabIndex={value ? 0 : -1} onMouseDown={(e) => e.preventDefault()} onClick={clear}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
      </button>
    </div>
  );
}
