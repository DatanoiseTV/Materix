import { describe, it, expect } from "vitest";
import { assessLink } from "./linkSafety";

// assessLink is pure (URL + regex), so it runs in the default node environment.
describe("assessLink", () => {
  it("passes a plain https link with no reasons", () => {
    const a = assessLink("https://example.com/docs");
    expect(a.suspicious).toBe(false);
    expect(a.reasons).toHaveLength(0);
    expect(a.host).toBe("example.com");
  });

  it("flags a URL shortener (true destination hidden)", () => {
    const a = assessLink("https://bit.ly/abc123");
    expect(a.suspicious).toBe(true);
    expect(a.reasons.join(" ")).toMatch(/shortened/i);
  });

  it("flags a raw IP address", () => {
    expect(assessLink("http://192.168.1.1/login").suspicious).toBe(true);
    expect(assessLink("http://192.168.1.1/login").reasons.join(" ")).toMatch(/IP address/i);
  });

  it("flags a punycode / IDN look-alike domain", () => {
    const a = assessLink("https://xn--pypal-4ve.com");
    expect(a.suspicious).toBe(true);
    expect(a.reasons.join(" ")).toMatch(/punycode/i);
  });

  it("flags embedded credentials in the authority", () => {
    const a = assessLink("https://paypal.com@evil.example/login");
    expect(a.suspicious).toBe(true);
    expect(a.reasons.join(" ")).toMatch(/username/i);
    // The real host is the part after @, not the disguise before it.
    expect(a.host).toBe("evil.example");
  });

  it("flags a non-web scheme", () => {
    const a = assessLink("javascript:alert(1)");
    expect(a.suspicious).toBe(true);
    expect(a.reasons.join(" ")).toMatch(/scheme/i);
  });

  it("flags anchor text that names a different site than the href", () => {
    const a = assessLink("https://evil.example/login", "paypal.com");
    expect(a.suspicious).toBe(true);
    expect(a.reasons.join(" ")).toMatch(/link text/i);
  });

  it("does not flag anchor text that matches the destination", () => {
    const a = assessLink("https://example.com/page", "example.com");
    expect(a.suspicious).toBe(false);
  });

  it("flags a malformed URL", () => {
    const a = assessLink("not a url");
    expect(a.suspicious).toBe(true);
    expect(a.reasons.join(" ")).toMatch(/malformed/i);
  });
});
