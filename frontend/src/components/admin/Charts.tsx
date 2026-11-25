"use client";

import { useEffect, useId, useRef, useState } from "react";

// Small dependency-free SVG charts used on Home and Sales insights. Colours are fixed hexes that read on the light admin surface.
export const PALETTE = ["#f97203", "#2f80ed", "#27ae60", "#9b51e0", "#eb5757", "#f2c94c", "#00b8d9", "#ff6b9a"];

/** Smooth area line with a soft fill, faint grid, last-point marker and a hover read-out. */
export function AreaChart({ points, fmt, height = 220, color = "#f97203" }: { points: { label: string; value: number }[]; fmt: (n: number) => string; height?: number; color?: string }) {
  const id = useId().replace(/:/g, "");
  const box = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(640); // follows the container so text keeps its real size
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const set = () => { const w = Math.max(240, Math.round(el.clientWidth)); setW((cur) => (Math.abs(cur - w) > 1 ? w : cur)); };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height, L = 8, R = 8, T = 16, B = 26;
  const n = points.length;
  if (n < 2) return <div className="ch-empty">Not enough days to draw a line yet.</div>;
  const max = Math.max(1, ...points.map((p) => p.value));
  const top = niceMax(max);
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const pts = points.map((p, i) => [x(i), y(p.value)] as const);
  // gentle curve through the points
  const d = pts.map(([px, py], i) => {
    if (!i) return `M${px},${py}`;
    const [qx, qy] = pts[i - 1];
    const cx = (qx + px) / 2;
    return `C${cx},${qy} ${cx},${py} ${px},${py}`;
  }).join(" ");
  const area = `${d} L${x(n - 1)},${H - B} L${x(0)},${H - B} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1];
  const labelAt = Array.from(new Set([0, Math.floor((n - 1) / 3), Math.floor(((n - 1) * 2) / 3), n - 1]));
  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const rel = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((rel - L) / (W - L - R)) * (n - 1)))));
  };
  const h = hover;
  return (
    <div ref={wrap} style={{ width: "100%", minWidth: 0, overflow: "hidden" }}>
    <svg ref={box} className="ch-area" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <defs><linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".28" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {grid.map((g) => <line key={g} x1={L} x2={W - R} y1={T + (1 - g) * (H - T - B)} y2={T + (1 - g) * (H - T - B)} className="ch-grid" />)}
      <path d={area} fill={`url(#g${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {labelAt.map((i) => <text key={i} x={Math.min(Math.max(x(i), L + 14), W - R - 14)} y={H - 8} textAnchor="middle" className="ch-axis">{points[i].label}</text>)}
      <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r="4.5" fill="#fff" stroke={color} strokeWidth="2.5" />
      {h !== null && (
        <g>
          <line x1={pts[h][0]} x2={pts[h][0]} y1={T} y2={H - B} className="ch-cursor" />
          <circle cx={pts[h][0]} cy={pts[h][1]} r="5" fill={color} stroke="#fff" strokeWidth="2" />
          <g transform={`translate(${Math.min(Math.max(pts[h][0], 60), W - 60)},${Math.max(pts[h][1] - 40, 4)})`}>
            <rect x="-56" y="0" width="112" height="34" rx="8" className="ch-tip" />
            <text x="0" y="14" textAnchor="middle" className="ch-tip-l">{points[h].label}</text>
            <text x="0" y="28" textAnchor="middle" className="ch-tip-v">{fmt(points[h].value)}</text>
          </g>
        </g>
      )}
    </svg>
    </div>
  );
}

const niceMax = (m: number) => { const p = Math.pow(10, Math.floor(Math.log10(m))); const f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

/** Ring split into slices with the total in the middle and a legend beside it. */
export function Donut({ slices, center, sub, fmt }: { slices: { label: string; value: number; color?: string }[]; center: string; sub?: string; fmt?: (n: number) => string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const C = 2 * Math.PI * 46;
  let off = 0;
  const arcs = slices.map((s, i) => { const len = total ? (s.value / total) * C : 0; const a = { ...s, color: s.color ?? PALETTE[i % PALETTE.length], len: Math.max(0, len - (slices.length > 1 ? 2.5 : 0)), off }; off += len; return a; });
  return (
    <div className="ch-donut">
      <div className="ch-donut-ring">
        <svg viewBox="0 0 120 120" role="img" aria-label={`${center} ${sub ?? ""}`}>
          <circle cx="60" cy="60" r="46" className="ch-donut-bg" />
          {arcs.filter((a) => a.value > 0).map((a) => <circle key={a.label} cx="60" cy="60" r="46" fill="none" stroke={a.color} strokeWidth="13" strokeLinecap="butt" strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={-a.off} />)}
        </svg>
        <div className="ch-donut-mid"><b>{center}</b>{sub && <span>{sub}</span>}</div>
      </div>
      <ul className="ch-legend">
        {arcs.map((a) => <li key={a.label}><i style={{ background: a.color }} /><span>{a.label}</span><b>{fmt ? fmt(a.value) : a.value}</b><em>{total ? `${Math.round((a.value / total) * 100)}%` : "–"}</em></li>)}
        {!arcs.length && <li className="ch-empty">No data yet.</li>}
      </ul>
    </div>
  );
}

/** Horizontal bars with a name, an optional note and the value, all scaled to the biggest. */
export function HBars({ items, fmt, color, empty = "Nothing to show." }: { items: { label: string; value: number; note?: string; color?: string }[]; fmt?: (n: number) => string; color?: string; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <div className="ch-empty">{empty}</div>;
  return (
    <ul className="ch-hbars">
      {items.map((it, i) => (
        <li key={i}>
          <div className="ch-hb-top"><span>{it.label}{it.note && <small>{it.note}</small>}</span><b>{fmt ? fmt(it.value) : it.value}</b></div>
          <div className="ch-hb-track"><i style={{ width: `${Math.max(it.value ? 3 : 0, (it.value / max) * 100)}%`, background: it.color ?? color ?? "#14151a" }} /></div>
        </li>
      ))}
    </ul>
  );
}

/** 24 hour cells coloured by how much was sold: a heat strip. */
export function HeatStrip({ values, fmt }: { values: number[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="ch-heat" role="img" aria-label="Sales by hour of day">
      <div className="ch-heat-cells">
        {values.map((v, h) => <span key={h} title={`${h}:00 · ${fmt(v)}`} style={{ background: v ? `rgba(249,114,3,${0.15 + 0.85 * (v / max)})` : "#ececf1" }} />)}
      </div>
      <div className="ch-heat-axis">{[0, 6, 12, 18, 23].map((h) => <span key={h} style={{ left: `${(h / 23) * 100}%` }}>{h}h</span>)}</div>
    </div>
  );
}

/** Columns with rounded tops, for a handful of values side by side. */
export function Columns({ items, fmt }: { items: { label: string; value: number; color?: string }[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="ch-cols" role="img" aria-label="Column chart">
      {items.map((it, i) => (
        <div key={i} className="ch-col" title={`${it.label}: ${fmt(it.value)}`}>
          <b>{fmt(it.value)}</b>
          <div className="ch-col-track"><i style={{ height: `${Math.max(it.value ? 4 : 0, (it.value / max) * 100)}%`, background: it.color ?? PALETTE[i % PALETTE.length] }} /></div>
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
