"use client";

import { PasswordInput } from "@/components/admin/PasswordInput";
import Link from "next/link";
import { email as emailErr, required } from "@/lib/validators";
import { FieldError, useValidation } from "@/components/admin/validation";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { auth, api, type AdminUser } from "@/lib/api";
import { actions, icons, links, settingsLinks } from "@/components/admin/nav";
import { StoreSwitcher } from "@/components/admin/StoreSwitcher";
import { NoAccess } from "@/components/admin/NoAccess";
import { PermsProvider, ROUTE_PERMS } from "@/lib/perms";
import { AdminMarketProvider } from "@/lib/adminMarket";
import { MarketPicker } from "@/components/admin/MarketPicker";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
);

// Collapsible sub-menu: always rendered so it can animate open and closed; `inert` keeps hidden links out of the tab order.
const Sub = ({ open, children }: { open: boolean; children: React.ReactNode }) => (
  <div className={`subwrap ${open ? "open" : ""}`} aria-hidden={!open} {...(open ? {} : { inert: true })}>
    <div className="sub">{children}</div>
  </div>
);
const SUBS: Record<string, (path: string) => boolean> = {
  "Online Store": (p) => p.startsWith("/admin/online-store"),
  Products: (p) => p.startsWith("/admin/products") || p.startsWith("/admin/collections") || p.startsWith("/admin/gift-cards") || p.startsWith("/admin/reviews"),
  Orders: (p) => p.startsWith("/admin/orders"),
};
const Chevron = ({ open }: { open: boolean }) => (
  <svg className={`chev ${open ? "open" : ""}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);

function Login({ onDone }: { onDone: (u: AdminUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false); // the account has two-factor sign-in on
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const val = useValidation({ email: emailErr(email, true), password: required(password, "Enter your password"), code: needCode ? required(code, "Enter the 6-digit code") : "" });
  const submit = async () => {
    if (!val.submit()) return;
    setBusy(true);
    setErr("");
    try {
      onDone(await auth<AdminUser>("/login", { method: "POST", json: { email, password, ...(needCode ? { code: code.trim() } : {}) } }));
    } catch (e) {
      const m = (e as Error).message;
      if (/6-digit|code is not right/i.test(m)) { setNeedCode(true); if (needCode) setCode(""); }
      setErr(m);
      setBusy(false);
    }
  };
  return (
    <div className="admin">
      <form className="card login" method="post" action="/admin" noValidate autoComplete="on" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="brand" style={{ marginBottom: 16, color: "#303030" }}>
          <span className="logo" style={{ width: 28, height: 28, borderRadius: 8, background: "#95bf47", display: "grid", placeItems: "center", fontWeight: 800 }}>U</span>
          UtsavVibe
        </div>
        <h2 style={{ marginBottom: 16 }}>Log in</h2>
        <div className="field">
          <label htmlFor="lg-email">Email</label>
          <input id="lg-email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} autoFocus value={email} onChange={(e) => setEmail(e.target.value)} {...val.props("email")} />
          <FieldError k="email" msg={val.err("email")} />
        </div>
        <div className="field">
          <label htmlFor="lg-pw">Password</label>
          <PasswordInput id="lg-pw" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} {...val.props("password")} />
          <FieldError k="password" msg={val.err("password")} />
        </div>
        {needCode && (
          <div className="field">
            <label htmlFor="lg-code">Authentication code</label>
            <input id="lg-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} autoFocus placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} {...val.props("code")} />
            <FieldError k="code" msg={val.err("code")} />
            <div className="muted">Open your authenticator app and type the 6-digit code for UtsavVibe.</div>
          </div>
        )}
        {err && <div className="error">{err}</div>}
        <button className="primary" type="submit" style={{ width: "100%" }} disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
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
  const [sq, setSq] = useState(""); // settings search
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    auth<AdminUser>("/me").then((u) => { setUser(u); try { localStorage.setItem("uv_me_cache", JSON.stringify(u)); } catch { /* private mode */ } }).catch((e) => {
      // No connection (not a 401): the in-store till may keep working offline with the last signed-in user. Everything is re-checked by the API when sales sync.
      if (e instanceof TypeError && location.pathname.startsWith("/admin/sell")) { try { const c = localStorage.getItem("uv_me_cache"); if (c) return setUser(JSON.parse(c) as AdminUser); } catch { /* fall through */ } }
      setUser(null);
    });
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

  const can = (perm: string) => !perm || user.owner || user.permissions.includes(perm) || (perm.endsWith(".view") && user.permissions.includes(perm.replace(/\.view$/, ".manage")));
  const needs = ROUTE_PERMS.find(([prefix]) => path === prefix || path.startsWith(prefix + "/"))?.[1];
  const inSettings = path.startsWith("/admin/settings");
  const active = (href: string) => (href === "/admin" ? path === href : path.startsWith(href));
  const allowedActions = actions.filter((a) => { const p = ROUTE_PERMS.find(([prefix]) => a.href.startsWith(prefix))?.[1]; return !p || can(p); });
  const matches = q ? allowedActions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];
  const go = (href: string) => { setQ(""); setOpen(false); searchRef.current?.blur(); router.push(href); };
  const name = user.name || user.email;
  const isDrafts = path.startsWith("/admin/orders/new") || path.endsWith("/edit") || (path === "/admin/orders" && qs.includes("status=draft"));

  return (
    <PermsProvider value={user}>
    <AdminMarketProvider user={user}>
    <div className="admin">
      <header className="mbar">
        <button className="burger" aria-label="Open menu" aria-expanded={menu} onClick={() => setMenu(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <span className="logo">U</span><b>UtsavVibe</b>
      </header>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <div className={`shell ${inSettings ? "withrail" : ""}`}>
        {/* One main sidebar that collapses to an icon rail under /admin/settings; the settings menu slides in beside it. Pure CSS transitions on the grid columns. */}
        <nav className={`side main ${inSettings ? "collapsed" : ""} ${menu ? "open" : ""}`} aria-label="Main">
          <Link href="/admin" className="brand" title="Home"><span className="logo">U</span></Link>
          <div className="searchbox">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icons.search} /></svg>
            <input
              ref={searchRef}
              placeholder="Search"
              value={q}
              tabIndex={inSettings ? -1 : 0}
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
          {!inSettings && <MarketPicker />}
          {links.filter((l) => can(l.perm)).map((l) => (
            <div key={l.href} style={{ display: "contents" }}>
              {l.label === "Online Store" && <div className="navhead"><span>Sales channels</span></div>}
              <Link href={l.href} title={l.label} aria-label={l.label} className={!inSettings && active(l.href) && !(l.label === "Orders" && isDrafts) ? "active" : ""}>
                <Icon d={l.icon} /><span className="navlbl">{l.label}</span>
                {l.label === "Orders" && toFulfil > 0 && <span className="count">{toFulfil}</span>}
                {SUBS[l.label] && !inSettings && <Chevron open={SUBS[l.label](path)} />}
              </Link>
              {l.label === "Online Store" && (
                <Sub open={!inSettings && path.startsWith("/admin/online-store")}>
                  <Link href="/admin/online-store/pages" className={path.startsWith("/admin/online-store/pages") ? "active" : ""}>Pages</Link>
                  <Link href="/admin/online-store/blog" className={path.startsWith("/admin/online-store/blog") ? "active" : ""}>Blog posts</Link>
                  <Link href="/admin/online-store/redirects" className={path.startsWith("/admin/online-store/redirects") ? "active" : ""}>Redirects</Link>
                  <Link href="/admin/online-store/preferences" className={path.startsWith("/admin/online-store/preferences") ? "active" : ""}>Preferences</Link>
                  <a href="/uk" target="_blank" rel="noreferrer">View your store ↗</a>
                </Sub>
              )}
              {l.label === "Products" && (
                <Sub open={!inSettings && SUBS.Products(path)}>
                  <Link href="/admin/products" className={path.startsWith("/admin/products") && !path.startsWith("/admin/products/import") ? "active" : ""}>All products</Link>
                  {can("products.view") && <Link href="/admin/collections" className={path.startsWith("/admin/collections") ? "active" : ""}>Collections</Link>}
                  {can("gift_cards.view") && <Link href="/admin/gift-cards" className={path.startsWith("/admin/gift-cards") ? "active" : ""}>Gift cards</Link>}
                  {can("products.view") && <Link href="/admin/reviews" className={path.startsWith("/admin/reviews") ? "active" : ""}>Reviews</Link>}
                  {can("products.manage") && <Link href="/admin/products/import" className={path.startsWith("/admin/products/import") ? "active" : ""}>Import from Shopify</Link>}
                </Sub>
              )}
              {l.label === "Orders" && (
                <Sub open={!inSettings && path.startsWith("/admin/orders")}>
                  <Link href="/admin/orders" className={!isDrafts ? "active" : ""}>All orders</Link>
                  <Link href="/admin/orders?status=draft" className={isDrafts ? "active" : ""}>Drafts</Link>
                </Sub>
              )}
            </div>
          ))}
          <div className="grow" />
          <div className="sidefoot">
          <Link href="/admin/settings" title="Settings" aria-label="Settings" className={`settingslink ${inSettings ? "active" : ""}`}><Icon d={icons.settings} /><span className="navlbl">Settings</span></Link>
          <StoreSwitcher
            compact={inSettings}
            name={name}
            role={user.role}
            onLogout={async () => { await auth("/logout", { method: "POST" }).catch(() => {}); try { localStorage.removeItem("uv_me_cache"); } catch { /* ignore */ } setUser(null); }}
          />
          </div>
        </nav>
        <nav className={`side setpanel ${inSettings ? "show" : ""} ${menu ? "open" : ""}`} aria-label="Settings" aria-hidden={!inSettings}>
          <div className="setpanel-in">
            <Link href="/admin" className="setback"><Icon d={icons.back} />Settings</Link>
            <div className="searchbox">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icons.search} /></svg>
              <input placeholder="Search settings" value={sq} tabIndex={inSettings ? 0 : -1} onChange={(e) => setSq(e.target.value)} aria-label="Search settings" />
            </div>
            {settingsLinks.filter((l) => can(l.perm) && l.label.toLowerCase().includes(sq.toLowerCase())).map((l) => (
              <Link key={l.href} href={l.href} tabIndex={inSettings ? 0 : -1} className={active(l.href) ? "active" : ""}><Icon d={l.icon} />{l.label}</Link>
            ))}
          </div>
        </nav>
        <main className={`content ${path === "/admin" ? "is-home" : ""}`}><div className="inner">{needs && !can(needs) ? <NoAccess /> : children}</div></main>
      </div>
    </div>
    </AdminMarketProvider>
    </PermsProvider>
  );
}
