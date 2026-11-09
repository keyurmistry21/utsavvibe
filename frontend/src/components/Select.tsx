"use client";

import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Opt = { value: string; label: string; disabled?: boolean };
type ChangeEvt = { target: { value: string }; currentTarget: { value: string } };

const textOf = (n: ReactNode): string =>
  Array.isArray(n) ? n.map(textOf).join("") : typeof n === "string" || typeof n === "number" ? String(n) : isValidElement(n) ? textOf((n.props as { children?: ReactNode }).children) : "";

// Reads <option> / <optgroup> children, so call sites keep the same markup as a native <select>.
function parse(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  const walk = (nodes: ReactNode) =>
    Children.forEach(nodes, (c) => {
      if (!isValidElement(c)) return;
      const el = c as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
      if (el.type === "option") {
        const label = textOf(el.props.children);
        out.push({ value: el.props.value !== undefined ? String(el.props.value) : label, label, disabled: !!el.props.disabled });
      } else if (el.type === "optgroup" || el.type === Fragment) walk(el.props.children);
    });
  walk(children);
  return out;
}

const SEARCH_FROM = 8; // lists longer than this get a search box (provinces, countries)

// Custom dropdown: a field-style trigger plus a floating, keyboard-friendly list. Same props as <select> that this app uses.
export function Select({ value, onChange, children, disabled, className = "", style, id, title, ...aria }: {
  value?: string | number;
  onChange?: (e: ChangeEvt) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  title?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  onBlur?: () => void;
}) {
  const opts = useMemo(() => parse(children), [children]);
  const [inner, setInner] = useState<string>(() => String(value ?? opts[0]?.value ?? ""));
  const cur = value !== undefined ? String(value) : inner;
  const sel = opts.find((o) => o.value === cur);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // stays true during the close animation
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const [variant, setVariant] = useState("admin");
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const buf = useRef({ text: "", t: 0 });
  const uid = useId();

  useEffect(() => {
    if (open) { setMounted(true); return; }
    if (!mounted) return;
    const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dropdown-close-dur")) || 150;
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, mounted]);

  const showSearch = opts.length > SEARCH_FROM;
  const shown = useMemo(() => (query ? opts.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : opts), [opts, query]);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const flip = below < 220 && above > below; // open upwards when there isn't room underneath
    const maxH = Math.max(160, Math.min(340, flip ? above : below));
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 200) - 8)), width: Math.max(r.width, 200), maxH, ...(flip ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
  }, []);

  const openList = () => {
    if (disabled) return;
    setVariant(btn.current?.closest(".store") ? "store" : "admin");
    setQuery("");
    setActive(Math.max(0, opts.findIndex((o) => o.value === cur)));
    place();
    setOpen(true);
  };
  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); aria.onBlur?.(); };
  const choose = (o: Opt | undefined) => {
    if (!o || o.disabled) return;
    if (value === undefined) setInner(o.value);
    onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } });
    close();
  };
  const step = (dir: 1 | -1, from = active) => {
    for (let i = 1; i <= shown.length; i++) {
      const n = (from + dir * i + shown.length * 2) % shown.length;
      if (!shown[n].disabled) return n;
    }
    return from;
  };

  // close on outside click / resize / scroll elsewhere; follow the trigger while open
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) close(false); };
    const scroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) place(); }; // follow the trigger when a parent scrolls
    document.addEventListener("mousedown", down);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("resize", place); window.removeEventListener("scroll", scroll, true); };
  }, [open, place]);

  // focus the search box without letting the browser scroll the page/dialog behind
  useEffect(() => { if (open) searchRef.current?.focus({ preventScroll: true }); }, [open]);

  useEffect(() => { if (open) pop.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive(step(1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(step(-1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(step(1, -1)); }
    else if (e.key === "End") { e.preventDefault(); setActive(step(-1, 0)); }
    else if (e.key === "Enter" || (e.key === " " && !showSearch)) { e.preventDefault(); choose(shown[active]); }
    else if (!showSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      // type-ahead on short lists: "o" jumps to "Ontario"
      const now = Date.now();
      buf.current = { text: (now - buf.current.t < 700 ? buf.current.text : "") + e.key.toLowerCase(), t: now };
      const i = shown.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(buf.current.text));
      if (i >= 0) setActive(i);
    }
  };

  const label = sel?.label ?? "";
  const placeholder = !sel || sel.value === "";

  return (
    <>
      <button
        ref={btn}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        className={`selectbtn iconbtn ${open ? "is-open" : ""} ${className}`}
        style={style}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        aria-label={aria["aria-label"]}
        aria-invalid={aria["aria-invalid"] || undefined}
        aria-describedby={aria["aria-describedby"]}
        onBlur={() => { if (!open) aria.onBlur?.(); }}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKey}
      >
        <span className={`sb-label ${placeholder ? "ph" : ""}`}>{label || " "}</span>
        <svg className="sb-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
      </button>
      {mounted && pos && typeof document !== "undefined" &&
        createPortal(
          <div ref={pop} className={`selectpop ${open ? "" : "is-closing"}`} data-flip={pos.bottom !== undefined ? "up" : "down"} data-variant={variant} style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}>
            {showSearch && (
              <div className="ssearch">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" /></svg>
                <input ref={searchRef} value={query} placeholder="Search" aria-label="Search options" onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey} />
              </div>
            )}
            <div id={`${uid}-list`} role="listbox" aria-label={aria["aria-label"]} className="slist">
              {shown.map((o, i) => (
                <div
                  key={o.value + i}
                  data-i={i}
                  role="option"
                  aria-selected={o.value === cur}
                  aria-disabled={o.disabled || undefined}
                  className={`so ${i === active ? "active" : ""} ${o.value === cur ? "sel" : ""} ${o.disabled ? "dis" : ""}`}
                  onMouseMove={() => !o.disabled && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                >
                  <span className={o.value === "" ? "ph" : ""}>{o.label}</span>
                  {o.value === cur && o.value !== "" && <svg className="check" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>}
                </div>
              ))}
              {!shown.length && <div className="so empty">No matches</div>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
