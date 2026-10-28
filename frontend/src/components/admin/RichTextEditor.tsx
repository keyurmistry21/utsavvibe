"use client";

import { useEffect, useRef, useState } from "react";
import { cleanHtml } from "@/lib/cleanHtml";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Older products have plain-text descriptions: show them as paragraphs.
export const toEditorHtml = (v: string) => (v && !/<[a-z][\s\S]*>/i.test(v) ? v.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("") : v);

type Cmd = { label: string; title: string; run: () => void; active?: string };

// Small WYSIWYG box with an HTML source view (</>). The server sanitizes on save; `cleanHtml` strips anything active before pasted code is shown here.
export function RichTextEditor({ value, onChange, resetKey, invalid, onBlur }: { value: string; onChange: (html: string) => void; resetKey: string; invalid?: boolean; onBlur?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null); // non-null = showing the HTML source
  // load the initial HTML once per product (re-setting innerHTML on every keystroke would move the cursor)
  useEffect(() => { setSrc(null); if (ref.current) ref.current.innerHTML = cleanHtml(toEditorHtml(value)); }, [resetKey]);
  const toggleSource = () => {
    if (src === null) { setSrc(ref.current?.innerHTML ?? ""); return; }
    const clean = cleanHtml(src);
    if (ref.current) ref.current.innerHTML = clean;
    onChange(clean);
    setSrc(null);
  };

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    onChange(ref.current?.innerHTML ?? "");
  };
  const link = () => {
    const url = window.prompt("Link URL (https://…)");
    if (!url) return;
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(url.trim())) return window.alert("Links must start with https://, http://, mailto: or tel:");
    exec("createLink", url.trim());
  };
  const tools: (Cmd | "sep")[] = [
    { label: "B", title: "Bold", run: () => exec("bold") },
    { label: "I", title: "Italic", run: () => exec("italic") },
    { label: "U", title: "Underline", run: () => exec("underline") },
    "sep",
    { label: "H2", title: "Heading", run: () => exec("formatBlock", "h2") },
    { label: "H3", title: "Subheading", run: () => exec("formatBlock", "h3") },
    { label: "¶", title: "Paragraph", run: () => exec("formatBlock", "p") },
    "sep",
    { label: "• List", title: "Bulleted list", run: () => exec("insertUnorderedList") },
    { label: "1. List", title: "Numbered list", run: () => exec("insertOrderedList") },
    "sep",
    { label: "Link", title: "Insert link", run: link },
    { label: "Clear", title: "Clear formatting", run: () => exec("removeFormat") },
  ];
  const inSource = src !== null;

  return (
    <div className="rte" aria-invalid={invalid || undefined}>
      <div className="rte-bar" role="toolbar" aria-label="Formatting">
        {tools.map((t, i) => t === "sep" ? <span key={i} className="sep" /> : (
          <button key={t.title} type="button" title={t.title} aria-label={t.title} onMouseDown={(e) => e.preventDefault()} disabled={inSource} onClick={t.run} className={`rtebtn ${t.label === "B" ? "b" : t.label === "I" ? "i" : t.label === "U" ? "u" : ""}`}>{t.label}</button>
        ))}
        <span className="sep" />
        <button type="button" title="Edit HTML code" aria-label="Edit HTML code" aria-pressed={inSource} className={`rtebtn ${inSource ? "on" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={toggleSource}>&lt;/&gt; HTML</button>
      </div>
      {inSource && (
        <>
          <textarea className="rte-src" spellCheck={false} aria-label="HTML code" value={src} onChange={(e) => { setSrc(e.target.value); onChange(e.target.value); }} onBlur={onBlur} />
          <div className="rte-note">Allowed: text formatting, links, lists, tables, images and YouTube/Vimeo embeds. Scripts, styles and anything else are removed.</div>
        </>
      )}
      <div
        ref={ref}
        className="rte-body"
        style={inSource ? { display: "none" } : undefined}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Description"
        onInput={(e) => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
        onBlur={onBlur}
        onPaste={(e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }}
      />
    </div>
  );
}
