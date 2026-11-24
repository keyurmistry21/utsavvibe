"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CartLink } from "./CartLink";
import { MarketSwitcher } from "./MarketSwitcher";
import { WishLink } from "./wishlistContext";

export type NavItem = { label: string; href: string; children?: { label: string; href: string }[] };

// Header with a drop-down "mega" menu for items that have sub-links, and a slide-down menu on phones.
export function Header({ code, name, items, markets, current }: { code: string; name: string; items: NavItem[]; markets: { id: string; code: string; name: string; currency: string; on: boolean }[]; current: { code: string; currency: string } }) {
  const [open, setOpen] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const [sub, setSub] = useState<number | null>(null);
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (nav.current && !nav.current.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(null); setMenu(false); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, []);
  const close = () => { setOpen(null); setMenu(false); };

  return (
    <header className="sf-head">
      <button type="button" className="sf-burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">{menu ? <path d="M5 5l14 14M19 5L5 19" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
      </button>
      <Link href={`/${code}`} className="logo" aria-label={name} onClick={close}><img src="/theme/utsavvive-logo.webp" alt={name} width={150} height={77} /></Link>
      <nav aria-label="Main" ref={nav} className={menu ? "open" : ""}>
        {items.map((m, i) => m.children?.length ? (
          <div key={i} className={`mm ${open === i ? "on" : ""} ${sub === i ? "sub-on" : ""}`} onMouseEnter={() => setOpen(i)} onMouseLeave={() => setOpen(null)}>
            <div className="mm-top">
              <Link href={m.href} onClick={close}>{m.label}</Link>
              <button type="button" className="mm-caret" aria-label={`${m.label} menu`} aria-expanded={open === i || sub === i} onClick={() => { setOpen(open === i ? null : i); setSub(sub === i ? null : i); }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>
            <div className="mm-panel">
              <ul className={m.children.length > 6 ? "cols" : ""}>
                {m.children.map((c, j) => <li key={j}><Link href={c.href} onClick={close}>{c.label}</Link></li>)}
              </ul>
            </div>
          </div>
        ) : <Link key={i} href={m.href} onClick={close}>{m.label}</Link>)}
      </nav>
      <div className="sf-right">
        <form action={`/${code}/search`} method="get" className="sf-search" role="search">
          <input name="q" placeholder="Search" aria-label="Search products" />
          <button type="submit" aria-label="Search"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg></button>
        </form>
        <WishLink market={code} />
        <Link href={`/${code}/account`} className="sf-acct" aria-label="Account"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg></Link>
        <CartLink market={code} />
        <MarketSwitcher current={current} markets={markets} />
      </div>
    </header>
  );
}
