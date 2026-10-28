"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Modal } from "./Modal";
import { Plus } from "../Icons";

// Bottom-of-sidebar store menu. This app runs one store, so the list has just the current store; "Create store" explains how a second one is set up.
export function StoreSwitcher({ name: me, role, onLogout, compact = false }: { name: string; role: string | null; onLogout: () => void; compact?: boolean }) {
  const [name, setName] = useState("UtsavVibe");
  const [host, setHost] = useState("");
  const [open, setOpen] = useState(false);
  const [create, setCreate] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHost(location.host);
    fetch("/api/store/site").then((r) => (r.ok ? r.json() : null)).then((s) => s?.storeName && setName(s.storeName)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const initials = name.trim().slice(0, 2).toUpperCase();
  return (
    <div className={`storesw ${compact ? "compact" : ""}`} ref={box}>
      {open && (
        <div className="storepop" role="menu">
          <div className="storepop-h">Stores</div>
          <div className="storerow current" role="menuitem">
            <span className="avatar sq">{initials}</span>
            <span className="who"><b>{name}</b><small>{host}</small></span>
            <svg viewBox="0 0 20 20" aria-hidden="true" className="tick"><path d="M4 10.5l4 4 8-9" /></svg>
          </div>
          <a className="storerow" role="menuitem" href="/uk" target="_blank" rel="noreferrer"><span className="ico">↗</span><span className="who"><b>View online store</b></span></a>
          <button className="storerow" role="menuitem" onClick={() => { setOpen(false); setCreate(true); }}><span className="ico"><Plus /></span><span className="who"><b>Create store</b></span></button>
          <div className="storepop-sep" />
          <Link className="storerow" role="menuitem" href="/admin/settings/account" onClick={() => setOpen(false)}>
            <span className="avatar">{me.slice(0, 2).toUpperCase()}</span>
            <span className="who"><b>{me}</b>{role && <small>{role}</small>}</span>
          </Link>
          <button className="storerow" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>
            <span className="ico solid"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" /></svg></span><span className="who"><b>Log out</b></span>
          </button>
        </div>
      )}
      <button className="storebtn" title={compact ? name : undefined} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="avatar sq">{initials}</span>
        <span className="who"><b>{name}</b><small>{host}</small></span>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="chev"><path d="M6 8l4-4 4 4M6 12l4 4 4-4" /></svg>
      </button>
      {create && (
        <Modal title="Create store" onClose={() => setCreate(false)} footer={<button className="primary" onClick={() => setCreate(false)}>Got it</button>}>
          <p style={{ marginTop: 0 }}>Each store runs as its own copy of this app, with its own database, domain and Stripe account, so its customers, orders and staff stay completely separate.</p>
          <p className="muted">Managing several stores from one login isn't built yet. For now, set up the second store as a separate deployment (<code>make up</code> with another database), then sign in to it with its own admin.</p>
        </Modal>
      )}
    </div>
  );
}
