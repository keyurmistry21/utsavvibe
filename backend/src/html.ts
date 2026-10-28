import sanitizeHtml from "sanitize-html";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Product descriptions are authored in a rich-text box, then cleaned here before storing, so the storefront can render them safely.
// Formatting, tables, images and YouTube/Vimeo embeds survive. Never: scripts, styles, classes, event handlers, javascript: links, other iframes.
export function sanitizeDescription(input: string): string {
  let s = input.trim();
  if (!s) return "";
  // legacy plain-text descriptions: turn blank-line separated text into paragraphs
  if (!/<[a-z][\s\S]*>/i.test(s)) s = s.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return sanitizeHtml(s, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "sub", "sup", "ul", "ol", "li", "a", "h2", "h3", "h4", "blockquote", "pre", "code", "hr", "span", "div", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption", "iframe"],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt", "width", "height", "loading"], iframe: ["src", "width", "height", "allowfullscreen"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedIframeHostnames: ["www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"],
    allowIframeRelativeUrls: false,
    allowProtocolRelative: false,
    // an iframe whose address was not allowed loses its src; drop the empty shell too
    exclusiveFilter: (frame) => frame.tag === "iframe" && !frame.attribs.src,
    transformTags: {
      a: (_tag, attribs) => ({ tagName: "a", attribs: { href: attribs.href ?? "", target: "_blank", rel: "noopener noreferrer nofollow" } }),
      img: (_tag, attribs) => ({ tagName: "img", attribs: { ...attribs, loading: "lazy" } }),
      b: "strong",
      i: "em",
    },
  }).trim();
}

export const htmlToText = (html: string) =>
  sanitizeHtml(html.replace(/<\/(p|li|h2|h3|blockquote)>/gi, " ").replace(/<br\s*\/?>/gi, " "), { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();

export const normalizeHandle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
