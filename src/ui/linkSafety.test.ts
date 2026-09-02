import { describe, it, expect, beforeEach, vi } from "vitest";
import { assessLink, trustDomain, isTrusted } from "./linkSafety";

// assessLink is the phishing gate in front of openExternal: if it returns
// suspicious:false the user follows the link with no warning. It is a pure
// function of (href, text), so it is table-testable without a DOM.

const reasons = (href: string, text?: string) => assessLink(href, text).reasons;
const flagged = (href: string, text?: string) => assessLink(href, text).suspicious;

describe("assessLink — benign links", () => {
  it.each([
    ["https://example.com/page", undefined],
    ["http://example.com/page", undefined],
    ["https://sub.example.com/page", undefined],
    ["https://example.com/a?b=c#d", undefined],
  ])("does not flag %s", (href, text) => {
    expect(assessLink(href, text as string | undefined)).toMatchObject({
      suspicious: false,
      reasons: [],
    });
  });

  it("reports the lowercased host", () => {
    expect(assessLink("https://EXAMPLE.com/x").host).toBe("example.com");
  });
});

describe("assessLink — malformed input", () => {
  it.each(["not a url", "", "http://", "///"])("flags %j as malformed", (href) => {
    const a = assessLink(href);
    expect(a.suspicious).toBe(true);
    expect(a.host).toBe("");
    expect(a.reasons).toEqual(["This link is malformed."]);
  });
});

describe("assessLink — non-web schemes", () => {
  // The dangerous ones: these parse as valid URLs, so only the scheme check
  // stands between them and a click.
  it.each([
    ["javascript:alert(1)", "javascript"],
    ["data:text/html,<script>alert(1)</script>", "data"],
    ["file:///etc/passwd", "file"],
    ["ftp://example.com/x", "ftp"],
  ])("flags %s", (href, scheme) => {
    expect(flagged(href)).toBe(true);
    expect(reasons(href).some((r) => r.includes(`"${scheme}"`))).toBe(true);
  });
});

describe("assessLink — deceptive hosts", () => {
  it("flags embedded credentials", () => {
    expect(reasons("https://paypal.com@evil.example/")[0]).toMatch(/username/);
  });

  it("flags a raw IPv4 destination", () => {
    expect(reasons("http://192.168.1.1/login")[0]).toMatch(/raw IP address/);
  });

  it("flags a raw IPv6 destination", () => {
    // URL keeps the brackets in hostname, so the `includes(":")` arm catches it.
    expect(reasons("http://[::1]/login")[0]).toMatch(/raw IP address/);
  });

  it("flags a punycode label", () => {
    expect(reasons("https://xn--80ak6aa92e.com/")[0]).toMatch(/punycode/);
  });

  it("flags a known shortener", () => {
    expect(reasons("https://bit.ly/abc")[0]).toMatch(/shortened link/);
  });

  it("matches the shortener host case-insensitively", () => {
    // The host is lowercased before the set lookup.
    expect(flagged("https://BIT.LY/abc")).toBe(true);
  });

  it("does not treat a shortener name inside a longer domain as a shortener", () => {
    // bit.ly.evil.com is NOT bit.ly — an exact host match is correct here.
    expect(reasons("https://bit.ly.evil.com/abc")).toEqual([]);
  });
});

describe("assessLink — anchor text that names another site", () => {
  it("flags text naming a different site than the destination", () => {
    const r = reasons("https://evil.example/login", "paypal.com");
    expect(r[0]).toContain("paypal.com");
    expect(r[0]).toContain("evil.example");
  });

  it("flags a fully-qualified URL in the text pointing elsewhere", () => {
    expect(flagged("https://evil.example/", "https://paypal.com/signin")).toBe(true);
  });

  it("allows text whose registrable domain matches, across subdomains", () => {
    expect(flagged("https://mail.google.com/", "google.com")).toBe(false);
    expect(flagged("https://sub.example.com/", "example.com")).toBe(false);
  });

  it("ignores anchor text that is not a domain", () => {
    expect(flagged("https://example.com/", "Click here")).toBe(false);
  });
});

describe("assessLink — combined signals", () => {
  it("accumulates every reason that applies", () => {
    const a = assessLink("http://user:pw@192.168.1.1/", "example.com");
    expect(a.suspicious).toBe(true);
    // credentials + raw IP + anchor-text mismatch
    expect(a.reasons).toHaveLength(3);
  });
});

// ── Recorded gap, not a fix ────────────────────────────────────────────────
// The shortener lookup is an exact host match, so any subdomain — including the
// `www.` form that several of these services answer on — walks past it while
// the bare host is flagged. Asserting current behaviour rather than changing
// it: this is a test-coverage change, and widening the check is the
// maintainer's call. If it is tightened, this test fails and should be
// inverted deliberately.
describe("assessLink — known gap: shortener subdomains", () => {
  it("flags bit.ly but not www.bit.ly", () => {
    expect(flagged("https://bit.ly/abc")).toBe(true);
    expect(flagged("https://www.bit.ly/abc")).toBe(false);
  });
});

describe("trustDomain / isTrusted", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  it("is false before anything is trusted", () => {
    expect(isTrusted("example.com")).toBe(false);
  });

  it("trusts an exact host after trustDomain", () => {
    trustDomain("example.com");
    expect(isTrusted("example.com")).toBe(true);
  });

  it("extends trust to subdomains of a trusted registrable domain", () => {
    // Documented consequence of the registrable() grouping: trusting the
    // apex trusts everything under it.
    trustDomain("example.com");
    expect(isTrusted("mail.example.com")).toBe(true);
  });

  it("does not extend trust from one subdomain to a sibling", () => {
    trustDomain("a.example.com");
    expect(isTrusted("a.example.com")).toBe(true);
    expect(isTrusted("b.example.com")).toBe(false);
  });

  it("does not leak trust across different registrable domains", () => {
    trustDomain("example.com");
    expect(isTrusted("example.com.evil.test")).toBe(false);
  });

  it("survives corrupt storage instead of throwing", () => {
    localStorage.setItem("materix.trustedDomains", "{not json");
    expect(() => isTrusted("example.com")).not.toThrow();
    expect(isTrusted("example.com")).toBe(false);
  });
});

describe("assessLink — multi-label public suffixes (registrable domain)", () => {
  it("flags a look-alike on a two-label public suffix (co.uk)", () => {
    const a = assessLink("https://evil.co.uk/login", "paypal.co.uk");
    expect(a.suspicious).toBe(true);
    expect(a.reasons.join(" ")).toMatch(/link text/i);
  });

  it("does not flag a genuine multi-label-suffix site against its own text", () => {
    expect(assessLink("https://example.co.uk/help", "example.co.uk").suspicious).toBe(false);
  });
});
