// Client-side mirror of the server's sanitizer (backend/src/html.ts). The server is the real gate on save; this exists so
// pasted HTML can't run (onerror=, <script>) inside the admin while it is being shown in the editor.
const TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "s", "sub", "sup", "ul", "ol", "li", "a", "h2", "h3", "h4", "blockquote", "pre", "code", "hr", "span", "div", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption", "iframe"]);
const DROP = new Set(["script", "style", "noscript", "template", "object", "embed", "form", "input", "button", "textarea", "select", "link", "meta", "base", "svg", "math", "frame", "frameset"]);
const ATTRS: Record<string, string[]> = { a: ["href"], img: ["src", "alt", "width", "height"], iframe: ["src", "width", "height", "allowfullscreen"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] };
export const IFRAME_HOSTS = ["www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"];

const okUrl = (tag: string, v: string) => {
  const t = v.trim();
  if (tag === "iframe") { try { const u = new URL(t); return u.protocol === "https:" && IFRAME_HOSTS.includes(u.hostname); } catch { return false; } }
  if (tag === "img") return /^(https?:\/\/|\/)/i.test(t) && !t.startsWith("//");
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(t);
};

export function cleanHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (node: Element) => {
    for (const el of [...node.children]) {
      const tag = el.tagName.toLowerCase();
      if (DROP.has(tag)) { el.remove(); continue; }
      if (!TAGS.has(tag)) { walk(el); el.replaceWith(...el.childNodes); continue; }
      for (const a of [...el.attributes]) {
        const allowed = ATTRS[tag]?.includes(a.name.toLowerCase());
        if (!allowed || ((a.name === "href" || a.name === "src") && !okUrl(tag, a.value))) el.removeAttribute(a.name);
      }
      if (tag === "iframe" && !el.getAttribute("src")) { el.remove(); continue; }
      if (tag === "a") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer nofollow"); }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
