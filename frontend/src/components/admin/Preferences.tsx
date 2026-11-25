"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { maxLen, required } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { useApi } from "./hooks";
import { useDirty, useUnsavedGuard } from "./unsaved";
import { MenuCard, urlErr, type Item } from "./Menus";

type Prefs = { storeName: string; announcement: string; tagline: string; metaTitle: string; metaDescription: string; publicUrl: string; headerMenu: Item[]; footerMenu: Item[]; popup: { enabled: boolean; title: string; text: string } };

export function Preferences() {
  const { data, error } = useApi<Prefs>("/online-store/preferences");
  const [p, setP] = useState<Prefs | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setP(data); }, [data]);
  const menuErrors: Record<string, string> = {};
  (["header", "footer"] as const).forEach((k) => (p?.[k === "header" ? "headerMenu" : "footerMenu"] ?? []).forEach((it, i) => {
    menuErrors[`${k}-l${i}`] = it.label.trim() ? (it.label.length > 60 ? "Keep it under 60 characters" : "") : "Enter a label";
    menuErrors[`${k}-u${i}`] = urlErr(it.url);
    (it.children ?? []).forEach((c, j) => { menuErrors[`${k}-sl${i}-${j}`] = c.label.trim() ? (c.label.length > 60 ? "Keep it under 60 characters" : "") : "Enter a label"; menuErrors[`${k}-su${i}-${j}`] = urlErr(c.url); });
  }));
  const val = useValidation({
    ...menuErrors,
    storeName: p ? required(p.storeName, "Enter a store name") || maxLen(p.storeName, 60, "The store name") : "",
    publicUrl: p && p.publicUrl.trim() && !/^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(p.publicUrl.trim()) ? "Use a full address like https://utsavvibe.com" : "",
    announcement: p ? maxLen(p.announcement, 200, "The announcement") : "",
    tagline: p ? maxLen(p.tagline, 160, "The tagline") : "",
    metaTitle: p ? maxLen(p.metaTitle, 70, "The title") : "",
    metaDescription: p ? maxLen(p.metaDescription, 320, "The description") : "",
  });
  const { dirty, markSaved } = useDirty(p, !!p);
  const save = async (): Promise<boolean> => {
    if (!p || !val.submit()) return false;
    setSaving(true); setMsg(null);
    let ok = false;
    try {
      const clean = (m: Item[]) => m.map((x) => ({ label: x.label.trim(), url: x.url.trim(), ...(x.children?.length ? { children: x.children.map((c) => ({ label: c.label.trim(), url: c.url.trim() })) } : {}) }));
      await api("/online-store/preferences", { method: "PUT", json: { ...p, headerMenu: clean(p.headerMenu), footerMenu: clean(p.footerMenu) } }); setMsg({ ok: true, text: "Preferences saved. The storefront updates within a few seconds." }); markSaved(); ok = true; }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setSaving(false);
    return ok;
  };
  const { guard } = useUnsavedGuard(dirty, save);
  const { data: pages } = useApi<{ handle: string; title: string; visible: boolean }[]>("/online-store/pages");
  const { data: colls } = useApi<{ handle: string; title: string; visible: boolean }[]>("/collections");
  const quick = [
    { label: "Blog", url: "/blog" },
    { label: "All collections", url: "/collections" },
    ...(colls ?? []).filter((x) => x.visible).map((x) => ({ label: x.title, url: `/collections/${x.handle}` })),
    ...(pages ?? []).filter((x) => x.visible).map((x) => ({ label: x.title, url: `/pages/${x.handle}` })),
  ];
  const f = (k: "storeName" | "publicUrl" | "announcement" | "tagline" | "metaTitle" | "metaDescription", label: string, hint?: string, area = false) => p && (
    <div className="field"><label htmlFor={`pf-${k}`}>{label}</label>
      {area
        ? <textarea id={`pf-${k}`} rows={3} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} {...val.props(k)} />
        : <input id={`pf-${k}`} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} {...val.props(k)} />}
      {hint && <div className="muted">{hint}</div>}
      <FieldError k={k} msg={val.err(k)} />
    </div>
  );
  return (
    <>
      {guard}
      <div className="pagehead"><h2>Preferences</h2></div>
      {error && <div className="error">{error}</div>}
      {p && (
        <>
          <div className="card" style={{ maxWidth: 720 }}>
            <h3>Storefront</h3>
            {f("storeName", "Store name", "Shown in the header, footer and browser tab.")}
            {f("tagline", "Footer tagline")}
            {f("publicUrl", "Public store URL", "The address customers use, like https://utsavvibe.com. QR codes on labels open product pages here, so phones must be able to reach it. Leave empty to use the address you are browsing.")}
            {f("announcement", "Announcement bar", "Leave empty to show the free-shipping message for the customer's market.")}
          </div>
          <div className="card" style={{ maxWidth: 720 }}>
            <h3>Home page title and description</h3>
            <p className="muted" style={{ marginTop: -4 }}>What search engines show for your store's home page.</p>
            {f("metaTitle", "Title tag", `${p.metaTitle.length} of 70 characters used`)}
            {f("metaDescription", "Meta description", `${p.metaDescription.length} of 320 characters used`, true)}
          </div>
          <div className="card" style={{ maxWidth: 720 }}>
            <h3>Pop-up message</h3>
            <p className="muted" style={{ marginTop: -4 }}>A message shown once to each visitor, for example a festival greeting. It shows again when you change the text.</p>
            <label className="check"><input type="checkbox" checked={p.popup?.enabled ?? false} onChange={(e) => setP({ ...p, popup: { ...(p.popup ?? { title: "", text: "" }), enabled: e.target.checked } })} />Show the pop-up</label>
            <div className="field" style={{ marginTop: 12 }}><label htmlFor="pp-t">Title</label><input id="pp-t" maxLength={120} value={p.popup?.title ?? ""} onChange={(e) => setP({ ...p, popup: { ...(p.popup ?? { enabled: false, text: "" }), title: e.target.value } })} /></div>
            <div className="field"><label htmlFor="pp-x">Message</label><textarea id="pp-x" rows={5} maxLength={1000} value={p.popup?.text ?? ""} onChange={(e) => setP({ ...p, popup: { ...(p.popup ?? { enabled: false, title: "" }), text: e.target.value } })} /><div className="muted">Leave a blank line between paragraphs.</div></div>
          </div>
          <div style={{ maxWidth: 720 }}>
            <MenuCard id="header" title="Header menu" hint="Links across the top of every storefront page. A link of / is the shop home. Add drop-down links under an item to show a menu when visitors point at it." items={p.headerMenu} onChange={(headerMenu) => setP({ ...p, headerMenu })} val={val} quick={quick} subs />
            <MenuCard id="footer" title="Footer menu" hint="Links at the bottom of every page. Good for policies and contact." items={p.footerMenu} onChange={(footerMenu) => setP({ ...p, footerMenu })} val={val} quick={quick} />
          </div>
          {msg && <div className={msg.ok ? "okmsg" : "error"} style={{ maxWidth: 720 }}>{msg.text}</div>}
          <div className="savebar" style={{ maxWidth: 720 }}><span style={{ flex: 1 }} /><button className="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button></div>
        </>
      )}
    </>
  );
}
