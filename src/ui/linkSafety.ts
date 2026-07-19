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

/** Registrable-ish domain: the last two labels (good enough for trust grouping). */
function registrable(host: string): string {
  return host.split(".").slice(-2).join(".");
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

/** Open an external link in the system browser / new tab. */
export function openExternal(href: string): void {
  window.open(href, "_blank", "noopener,noreferrer");
}
