"use client";

import { useEffect, useRef, useState } from "react";
import { today, ymd } from "@/lib/dates";

// A calendar range picker: click a start day, then an end day. Replaces the browser's plain date boxes.
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmt = (s: string) => parse(s).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
const MONTH = (d: Date) => d.toLocaleDateString("en", { month: "long", year: "numeric" });
const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function Month({ view, from, to, hover, max, onPick, onHover }: { view: Date; from: string; to: string; hover: string; max: string; onPick: (d: string) => void; onHover: (d: string) => void }) {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => ymd(new Date(view.getFullYear(), view.getMonth(), i + 1)))];
  const end = to || hover; // while choosing the end day, preview the range under the pointer
  const [lo, hi] = from && end ? (from <= end ? [from, end] : [end, from]) : [from, from];
  return (
    <div className="rp-month">
      <div className="rp-title">{MONTH(view)}</div>
      <div className="rp-grid">
        {DOW.map((d) => <span key={d} className="rp-dow">{d}</span>)}
        {cells.map((c, i) => c === null ? <span key={"e" + i} /> : (
          <button key={c} type="button" disabled={c > max} onClick={() => onPick(c)} onMouseEnter={() => onHover(c)}
            className={`rp-day${c === today() ? " today" : ""}${lo && c >= lo && c <= hi ? " in" : ""}${c === lo ? " start" : ""}${c === hi ? " end" : ""}`} aria-label={fmt(c)} aria-pressed={c === from || c === to}>
            {Number(c.slice(8))}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DateRangePicker({ from, to, onChange, max = today() }: { from: string; to: string; onChange: (from: string, to: string) => void; max?: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => { const d = parse(from || max); return new Date(d.getFullYear(), d.getMonth() - 1, 1); }); // left month; the right one is the next
  const [pick, setPick] = useState<{ from: string; to: string }>({ from, to });
  const [hover, setHover] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const openIt = () => { setPick({ from, to }); setHover(""); const d = parse(to || from || max); setView(new Date(d.getFullYear(), d.getMonth() - 1, 1)); setOpen(true); };
  const choose = (d: string) => {
    if (!pick.from || pick.to) { setPick({ from: d, to: "" }); return; } // first click: new start
    const [a, b] = d < pick.from ? [d, pick.from] : [pick.from, d]; // second click: end (swap if earlier)
    setPick({ from: a, to: b });
    onChange(a, b);
    setOpen(false);
  };
  const shift = (n: number) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));
  const next = new Date(view.getFullYear(), view.getMonth() + 1, 1);
  const mx = parse(max);
  const canNext = next.getFullYear() * 12 + next.getMonth() + 1 <= mx.getFullYear() * 12 + mx.getMonth(); // the right-hand month may not pass the current month
  return (
    <div className="rp" ref={box}>
      <button type="button" className="rp-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? setOpen(false) : openIt())}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /></svg>
        <span><b>{from ? fmt(from) : "Start"}</b><i>→</i><b>{to ? fmt(to) : "End"}</b></span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="chev"><path d="M7 10l5 5 5-5" /></svg>
      </button>
      {open && (
        <div className="rp-pop" role="dialog" aria-label="Choose dates" onMouseLeave={() => setHover("")}>
          <div className="rp-nav">
            <button type="button" className="rp-arrow" onClick={() => shift(-1)} aria-label="Previous month"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg></button>
            <span className="rp-hint">{!pick.from || pick.to ? "Pick the first day" : "Now pick the last day"}</span>
            <button type="button" className="rp-arrow" onClick={() => shift(1)} disabled={!canNext} aria-label="Next month"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></button>
          </div>
          <div className="rp-months">
            <Month view={view} from={pick.from} to={pick.to} hover={hover} max={max} onPick={choose} onHover={setHover} />
            <Month view={next} from={pick.from} to={pick.to} hover={hover} max={max} onPick={choose} onHover={setHover} />
          </div>
        </div>
      )}
    </div>
  );
}
