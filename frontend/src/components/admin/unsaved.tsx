"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./Modal";

/**
 * Tells whether a form differs from how it looked when it loaded. Pass what the user edits; `ready` is false until the data has loaded
 * (the first ready value is the baseline). Call markSaved() after a successful save so the page counts as clean again.
 */
export function useDirty(value: unknown, ready = true) {
  const base = useRef<string | null>(null);
  const json = JSON.stringify(value);
  const [, bump] = useState(0);
  if (ready && base.current === null) base.current = json;
  return { dirty: ready && base.current !== null && json !== base.current, markSaved: () => { base.current = json; bump((n) => n + 1); } };
}

/**
 * While `dirty`: closing the tab or refreshing asks the browser's own question, and clicking an in-app link opens a
 * Keep editing / Discard / Save and leave dialog. `save` returns false when it could not save (the user stays).
 * Render `guard` anywhere in the page. Call `allow()` before navigating on purpose.
 */
export function useUnsavedGuard(dirty: boolean, save?: () => Promise<boolean | void>) {
  const router = useRouter();
  const [to, setTo] = useState<string | null>(null);
  const allowed = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!dirty || allowed.current) return;
    const beforeUnload = (e: BeforeUnloadEvent) => { if (allowed.current) return; e.preventDefault(); e.returnValue = ""; };
    const onClick = (e: MouseEvent) => {
      if (allowed.current) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || a.origin !== location.origin || (a.pathname === location.pathname && a.search === location.search)) return;
      e.preventDefault(); e.stopPropagation();
      setTo(a.pathname + a.search + a.hash);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", onClick, true); };
  }, [dirty]);

  const go = (href: string) => { allowed.current = true; setTo(null); router.push(href); };
  const guard = to ? (
    <Modal title="Unsaved changes" onClose={() => setTo(null)} footer={<><button onClick={() => setTo(null)}>Keep editing</button><span style={{ display: "flex", gap: 8 }}><button onClick={() => go(to)}>Discard changes</button>{save && <button className="primary" onClick={async () => { const ok = await saveRef.current?.(); if (ok !== false) go(to); else setTo(null); }}>Save and leave</button>}</span></>}>
      <p>You changed something here but haven't saved yet. Save before you leave, or throw the changes away?</p>
    </Modal>
  ) : null;
  return { guard, allow: () => { allowed.current = true; } };
}
