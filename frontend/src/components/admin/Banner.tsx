"use client";

import type { ReactNode } from "react";

export type BStat = { label: string; value: ReactNode; tone?: "ok" | "low" | "out" | "arch"; on?: boolean; onClick?: () => void };
export type BRing = { value: ReactNode; label: string; segs: { cls: "ok" | "low" | "out" | "arch"; n: number }[] };

// The dark summary banner used across the admin: an optional ring, a row of stat cards (clickable ones act as filters), and room for extra content.
export function Banner({ title, ring, stats, children }: { title: string; ring?: BRing; stats: BStat[]; children?: ReactNode }) {
  const C = 2 * Math.PI * 48;
  const total = ring ? ring.segs.reduce((a, s) => a + s.n, 0) : 0;
  let off = 0;
  const segs = (ring?.segs ?? []).filter((s) => s.n > 0).map((s) => { const len = (s.n / Math.max(1, total)) * C; const g = { cls: s.cls, len: Math.max(0, len - 3), off }; off += len; return g; });
  return (
    <div className="iv">
      <section className={`iv-hero bn-hero ${ring ? "" : "bn-noring"}`} aria-label={title}>
        {ring && (
          <div className="iv-ring" role="img" aria-label={ring.label}>
            <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" className="iv-ring-bg" />{segs.map((g) => <circle key={g.cls} cx="60" cy="60" r="48" className={`iv-ring-seg ${g.cls}`} strokeDasharray={`${g.len} ${C - g.len}`} strokeDashoffset={-g.off} />)}</svg>
            <div className="iv-ring-mid"><b>{ring.value}</b><span>{ring.label}</span></div>
          </div>
        )}
        <div className="iv-stats bn-stats">
          {stats.map((s, i) => {
            const inner = <><i /><b>{s.value}</b><span>{s.label}</span></>;
            return s.onClick
              ? <button key={i} className={`iv-stat ${s.tone ?? "ok"} ${s.on ? "on" : ""}`} onClick={s.onClick}>{inner}</button>
              : <div key={i} className={`iv-stat ${s.tone ?? "ok"} static`}>{inner}</div>;
          })}
        </div>
        {children && <div className="bn-extra">{children}</div>}
      </section>
    </div>
  );
}
