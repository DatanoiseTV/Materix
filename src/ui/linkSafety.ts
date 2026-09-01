// Link-safety heuristics for message links. Clicking a link that looks
// deceptive (shortener, raw IP, punycode homograph, embedded credentials, or
// anchor text that names a different site than the destination) prompts a
// warning first. Users can permanently trust a domain, stored locally.

const KEY = "materix.trustedDomains";

const SHORTENERS = new Set([
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "t.ly",
  "shorturl.at",
  "rb.gy",
  "adf.ly",
]);

export interface LinkAssessment {
  href: string;
  host: string;
  suspicious: boolean;
  reasons: string[];
}

// Two-label public suffixes where the registrable domain needs THREE labels
// (e.g. paypal.co.uk, not co.uk) — otherwise the same-site check treats every
// *.co.uk as one site and misses look-alikes. Not exhaustive (a full fix would
// use the Public Suffix List), but covers the common cases the check needs.
const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "net.uk", "sch.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
  "co.nz", "org.nz", "govt.nz", "ac.nz",
  "co.za", "org.za", "co.in", "co.kr", "co.il",
  "com.br", "com.cn", "com.mx", "com.tr", "com.sg", "com.hk", "com.tw",
  "github.io", "gitlab.io", "pages.dev", "web.app", "firebaseapp.com",
]);

/** Registrable-ish domain used for same-site grouping. Returns the last three
 * labels when the last two form a known multi-label public suffix, else two. */
function registrable(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return MULTI_LABEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

function trustedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function trustDomain(host: string): void {
  const s = trustedSet();
  s.add(host);
  localStorage.setItem(KEY, JSON.stringify([...s]));
}

export function isTrusted(host: string): boolean {
  const s = trustedSet();
  return s.has(host) || s.has(registrable(host));
}

function looksSameSite(shown: string, host: string): boolean {
  return registrable(shown) === registrable(host);
}

/**
 * Assess a link. `text` is the visible anchor text (for HTML links) and is used
 * to catch anchors whose text names a different site than the real href.
 */
export function assessLink(href: string, text?: string): LinkAssessment {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { href, host: "", suspicious: true, reasons: ["This link is malformed."] };
  }
  const host = url.hostname.toLowerCase();
  const scheme = url.protocol.replace(":", "");
  const reasons: string[] = [];

  if (scheme !== "http" && scheme !== "https") {
    reasons.push(`Opens with the "${scheme}" scheme instead of a normal web address.`);
  }
  if (url.username || url.password) {
    reasons.push("Contains a username in the address, which can disguise the real site.");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    reasons.push("Points to a raw IP address rather than a named site.");
  }
  if (host.split(".").some((l) => l.startsWith("xn--"))) {
    reasons.push("Uses punycode — the domain may imitate another using look-alike characters.");
  }
  if (SHORTENERS.has(host)) {
    reasons.push("Is a shortened link, so the true destination is hidden.");
  }
  if (text) {
    const m = text.trim().match(/^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(?:[/?#]|$)/i);
    if (m && !looksSameSite(m[1].toLowerCase(), host)) {
      reasons.push(`The link text shows "${m[1]}" but it actually goes to "${host}".`);
    }
  }

  return { href, host, suspicious: reasons.length > 0, reasons };
}

/** Open an external link in the system browser (desktop) or a new tab (web). */
export function openExternal(href: string): void {
  // In the Tauri desktop shell the webview intercepts window.open, so route
  // through the opener plugin to hand the URL to the OS browser.
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    import("@tauri-apps/plugin-opener")
      .then((m) => m.openUrl(href))
      .catch(() => window.open(href, "_blank", "noopener,noreferrer"));
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}
