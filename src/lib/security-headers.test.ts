import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const headerMap = (isDev: boolean) =>
  Object.fromEntries(securityHeaders(isDev).map((h) => [h.key, h.value]));

describe("security headers", () => {
  it("allow Plaid Link and nothing else from outside in production", () => {
    const csp = contentSecurityPolicy(false);

    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://cdn.plaid.com;");
    expect(csp).toContain("frame-src https://cdn.plaid.com;");
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

  it("relax only what local development needs", () => {
    const dev = headerMap(true);
    expect(dev["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(dev["Content-Security-Policy"]).toContain("ws:");
    expect(dev["Strict-Transport-Security"]).toBeUndefined();
  });
});
