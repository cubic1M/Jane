import { describe, expect, it } from "vitest";
import {
  DOCUMENT_FILE_CSP,
  chatFrameHeaders,
  contentSecurityPolicy,
  securityHeaders,
} from "./security-headers";

const headerMap = (isDev: boolean) =>
  Object.fromEntries(securityHeaders(isDev).map((h) => [h.key, h.value]));

describe("security headers", () => {
  it("allow Plaid Link and nothing else from outside in production", () => {
    const csp = contentSecurityPolicy(false);

    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://cdn.plaid.com;");
    expect(csp).toContain("frame-src 'self' https://cdn.plaid.com;");
    expect(csp).toContain(
      "connect-src 'self' https://production.plaid.com https://sandbox.plaid.com;",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("send HSTS and the usual hardening headers in production", () => {
    expect(headerMap(false)).toMatchObject({
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
  });

  it("let only our own pages frame the chat, for the side panel", () => {
    const chat = Object.fromEntries(chatFrameHeaders(false).map((h) => [h.key, h.value]));
    expect(chat["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(chat["Content-Security-Policy"]).not.toContain("frame-ancestors 'none'");
    expect(chat["X-Frame-Options"]).toBe("SAMEORIGIN");
    // Everything else stays as strict as the rest of the site.
    expect(chat["Content-Security-Policy"]).toBe(
      contentSecurityPolicy(false).replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
    );
  });

  it("relax only what local development needs", () => {
    const dev = headerMap(true);
    expect(dev["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(dev["Content-Security-Policy"]).toContain("ws:");
    expect(dev["Strict-Transport-Security"]).toBeUndefined();
  });

  it("sandbox uploaded documents and load nothing alongside them", () => {
    expect(DOCUMENT_FILE_CSP).toMatch(/^sandbox;/);
    expect(DOCUMENT_FILE_CSP).toContain("default-src 'none'");
    expect(DOCUMENT_FILE_CSP).not.toContain("script-src");
  });
});
