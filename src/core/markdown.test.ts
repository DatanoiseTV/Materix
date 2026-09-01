// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeIncomingHtml, markdownToMatrixHtml } from "./markdown";

// The sanitizer is the XSS boundary in front of dangerouslySetInnerHTML — these
// tests pin that hostile formatted_body can't smuggle script/handlers/embeds
// through it. Needs a DOM (DOMPurify), hence the jsdom environment above.
describe("sanitizeIncomingHtml", () => {
  it("removes <script> and its contents", () => {
    const out = sanitizeIncomingHtml('<script>alert(1)</script>hello');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("hello");
  });

  it("drops a javascript: href but keeps the text", () => {
    const out = sanitizeIncomingHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain("click");
  });

  it("strips inline event handlers", () => {
    const out = sanitizeIncomingHtml('<a href="https://ok.example" onclick="steal()">x</a>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toContain("steal()");
  });

  it("removes non-allowed embeds (img, svg)", () => {
    expect(sanitizeIncomingHtml('<img src=x onerror="alert(1)">')).not.toMatch(/<img/i);
    expect(sanitizeIncomingHtml('<svg><desc>x</desc></svg>')).not.toMatch(/<svg/i);
  });

  it("keeps allow-listed formatting tags", () => {
    const out = sanitizeIncomingHtml("<strong>bold</strong> <code>x=1</code>");
    expect(out).toMatch(/<strong>bold<\/strong>/);
    expect(out).toMatch(/<code>/);
  });

  it("forces target=_blank and rel=noopener noreferrer on links", () => {
    const out = sanitizeIncomingHtml('<a href="https://ok.example">z</a>');
    expect(out).toContain('href="https://ok.example"');
    expect(out).toMatch(/target="_blank"/);
    expect(out).toMatch(/rel="noopener noreferrer"/);
  });
});

describe("markdownToMatrixHtml", () => {
  it("returns undefined for plain text (keeps plain messages plain)", () => {
    expect(markdownToMatrixHtml("just a plain sentence")).toBeUndefined();
  });

  it("renders markdown to sanitized HTML", () => {
    const out = markdownToMatrixHtml("**bold** and `code`");
    expect(out).toBeDefined();
    expect(out).toMatch(/<strong>bold<\/strong>/);
  });

  it("sanitizes script smuggled through markdown", () => {
    const out = markdownToMatrixHtml("**x**<script>alert(1)</script>");
    expect(out).toBeDefined();
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("alert(1)");
  });
});
