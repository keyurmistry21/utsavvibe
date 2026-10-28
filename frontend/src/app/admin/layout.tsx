"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { auth, api, type AdminUser } from "@/lib/api";
import { actions, icons, links } from "@/components/admin/nav";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
);

function Login({ onDone }: { onDone: (u: AdminUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      onDone(await auth<AdminUser>("/login", { method: "POST", json: { email, password } }));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="admin">
      <form className="card login" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="brand" style={{ marginBottom: 16, color: "#303030" }}>
          <span className="logo" style={{ width: 28, height: 28, borderRadius: 8, background: "#95bf47", display: "grid", placeItems: "center", fontWeight: 800 }}>U</span>
          UtsavVibe
        </div>
        <h2 style={{ marginBottom: 16 }}>Log in</h2>
        <div className="field">
          <label>Email</label>
          <input type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <div className="error">{err}</div>}
        <button className="primary" type="submit" style={{ width: "100%" }} disabled={busy || !email || !password}>{busy ? "Logging in…" : "Log in"}</button>
      </form>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  // localStorage isn't available during SSR; decide after mount.
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined);
  const [toFulfil, setToFulfil] = useState(0);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false); // mobile drawer
  const [qs, setQs] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    auth<AdminUser>("/me").then(setUser).catch(() => setUser(null));
    const out = () => setUser(null); // any admin call returning 401 drops back to the login screen
    window.addEventListener("admin:unauthorized", out);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("admin:unauthorized", out);
      window.removeEventListener("keydown", key);
    };
  }, []);

  useEffect(() => { setMenu(false); setQs(location.search); }, [path]);

  useEffect(() => {
    if (user) api<{ toFulfil: number }>("/analytics/status").then((s) => setToFulfil(s.toFulfil)).catch(() => {});
  }, [user, path]);

  if (user === undefined) return null;
  if (!user) return <Login onDone={setUser} />;

  const active = (href: string) => (href === "/admin" ? path === href : path.startsWith(href));
  const matches = q ? actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];
  const go = (href: string) => { setQ(""); setOpen(false); searchRef.current?.blur(); router.push(href); };
  const name = user.name || user.email;
  const isDrafts = path.startsWith("/admin/orders/new") || path.endsWith("/edit") || (path === "/admin/orders" && qs.includes("status=draft"));

  return (
    <div className="admin">
      <header className="mbar">
        <button className="burger" aria-label="Open menu" aria-expanded={menu} onClick={() => setMenu(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <span className="logo">U</span><b>UtsavVibe</b>
      </header>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <div className="shell">
        <nav className={`side ${menu ? "open" : ""}`}>
          <div className="brand"><span className="logo">U</span></div>
          <div className="searchbox">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icons.search} /></svg>
            <input
              ref={searchRef}
              placeholder="Search"
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) go(matches[0].href); if (e.key === "Escape") { setQ(""); searchRef.current?.blur(); } }}
            />
            <kbd>⌘K</kbd>
            {open && !!matches.length && (
              <ul className="results">{matches.map((m) => <li key={m.href}><button onMouseDown={() => go(m.href)}>{m.label}</button></li>)}</ul>
            )}
          </div>
          {links.map((l) => (
            <div key={l.href} style={{ display: "contents" }}>
              <Link href={l.href} className={active(l.href) && !(l.label === "Orders" && isDrafts) ? "active" : ""}>
                <Icon d={l.icon} />{l.label}
                {l.label === "Orders" && toFulfil > 0 && <span className="count">{toFulfil}</span>}
              </Link>
              {l.label === "Orders" && path.startsWith("/admin/orders") && (
                <div className="sub">
                  <Link href="/admin/orders" className={!isDrafts ? "active" : ""}>All orders</Link>
                  <Link href="/admin/orders?status=draft" className={isDrafts ? "active" : ""}>Drafts</Link>
                </div>
              )}
            </div>
          ))}
          <div className="grow" />
          <Link href="/admin/settings" className={active("/admin/settings") ? "active" : ""}><Icon d={icons.settings} />Settings</Link>
          <div className="me">
            <span className="avatar">{name.slice(0, 2).toUpperCase()}</span>
            <span className="who">{name}</span>
            <button className="navbtn out" title="Log out" onClick={async () => { await auth("/logout", { method: "POST" }).catch(() => {}); setUser(null); }}><Icon d={icons.out} /></button>
          </div>
        </nav>
        <main className={`content ${path === "/admin" ? "is-home" : ""}`}><div className="inner">{children}</div></main>
      </div>
    </div>
  );
}
