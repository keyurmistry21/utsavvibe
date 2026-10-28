"use client";

import { useEffect, useRef } from "react";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Older products have plain-text descriptions: show them as paragraphs.
export const toEditorHtml = (v: string) => (v && !/<[a-z][\s\S]*>/i.test(v) ? v.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("") : v);

type Cmd = { label: string; title: string; run: () => void; active?: string };

// Small WYSIWYG box. The server sanitizes the HTML on save, so this only needs to be convenient, not safe.
export function RichTextEditor({ value, onChange, resetKey }: { value: string; onChange: (html: string) => void; resetKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // load the initial HTML once per product (re-setting innerHTML on every keystroke would move the cursor)
  useEffect(() => { if (ref.current) ref.current.innerHTML = toEditorHtml(value); }, [resetKey]);

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

  return (
    <div className="rte">
      <div className="rte-bar" role="toolbar" aria-label="Formatting">
        {tools.map((t, i) => t === "sep" ? <span key={i} className="sep" /> : (
          <button key={t.title} type="button" title={t.title} aria-label={t.title} onMouseDown={(e) => e.preventDefault()} onClick={t.run} className={`rtebtn ${t.label === "B" ? "b" : t.label === "I" ? "i" : t.label === "U" ? "u" : ""}`}>{t.label}</button>
        ))}
      </div>
      <div
        ref={ref}
        className="rte-body"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Description"
        onInput={(e) => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
        onPaste={(e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }}
      />
    </div>
  );
}
