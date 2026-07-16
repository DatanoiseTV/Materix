// Outgoing: markdown -> Matrix HTML (org.matrix.custom.html).
// Incoming: sanitize untrusted formatted_body with an allow-list per the
// Matrix spec's recommended tag set. Everything rendered with
// dangerouslySetInnerHTML MUST pass through sanitizeIncomingHtml.

import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

// Matrix spec 11.2.1.7 recommended tags, minus scripts/media embeds.
const ALLOWED_TAGS = [
  "font", "del", "s", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
  "p", "a", "ul", "ol", "sup", "sub", "li", "b", "i", "u", "strong", "em",
  "strike", "code", "hr", "br", "div", "table", "thead", "tbody", "tr",
  "th", "td", "caption", "pre", "span", "details", "summary",
];
const ALLOWED_ATTR = ["href", "name", "target", "rel", "start", "colspan", "rowspan", "data-mx-spoiler", "data-mx-color", "data-mx-bg-color", "class"];

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (!/^(https?|matrix|mailto|magnet):/i.test(href)) {
      node.removeAttribute("href");
    }
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  // Only language- classes on code blocks survive; drop anything else.
  if (node.hasAttribute("class")) {
    const cls = (node.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter((c) => c.startsWith("language-"))
      .join(" ");
    if (cls) node.setAttribute("class", cls);
    else node.removeAttribute("class");
  }
});

export function sanitizeIncomingHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

/** Strip the spec's <mx-reply> fallback prefix from formatted bodies. */
export function stripReplyFallbackHtml(html: string): string {
  return html.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/i, "");
}

/** Strip the plaintext reply fallback ("> <@user> ..." quoted lines). */
export function stripReplyFallbackText(text: string): string {
  if (!text.startsWith("> ")) return text;
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].startsWith("> ")) i++;
  while (i < lines.length && lines[i] === "") i++;
  return lines.slice(i).join("\n");
}

/**
 * Compose markdown to Matrix HTML. Returns undefined when the input has no
 * markup at all, so plain messages stay plain (smaller events, better
 * fallback rendering on other clients).
 */
export function markdownToMatrixHtml(text: string): string | undefined {
  const html = (marked.parse(text, { async: false }) as string).trim();
  const plainEquivalent = `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  if (html === plainEquivalent) return undefined;
  return sanitizeIncomingHtml(html);
}

/** One-line plain-text preview: reply fallback and markdown decoration removed. */
export function previewText(body: string): string {
  let s = stripReplyFallbackText(body).split("\n").find((l) => l.trim()) ?? "";
  s = s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images -> label
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "");
  return s.trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
