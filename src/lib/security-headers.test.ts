import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import {
  API_CSP,
  CHAT_FRAME_HEADERS,
  DOCUMENT_FILE_CSP,
  PERMISSIONS_POLICY,
  contentSecurityPolicy,
  newNonce,
  pageCsp,
  securityHeaders,
} from "./security-headers";

const headerMap = (isDev: boolean) =>
  Object.fromEntries(securityHeaders(isDev).map((h) => [h.key, h.value]));

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d === name || d.startsWith(`${name} `))
    ?.split(" ")
    .slice(1);

describe("the page Content-Security-Policy", () => {
  const csp = contentSecurityPolicy({ nonce: "abc123", isDev: false });

  it("runs only scripts with this request's nonce, and what they load", () => {
    expect(directive(csp, "script-src")).toEqual([
      "'self'",
      "'nonce-abc123'",
      "'strict-dynamic'",
      "https://cdn.plaid.com",
    ]);
    // No way around the nonce: no inline scripts, no eval, in production.
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows Plaid Link and nothing else from outside", () => {
    expect(directive(csp, "frame-src")).toEqual(["'self'", "https://cdn.plaid.com"]);
    expect(directive(csp, "connect-src")).toEqual([
      "'self'",
      "https://production.plaid.com",
      "https://sandbox.plaid.com",
    ]);
    for (const name of ["img-src", "font-src", "style-src", "worker-src", "manifest-src"]) {
      expect(directive(csp, name)?.filter((v) => v.startsWith("http"))).toEqual([]);
    }
  });

  it("can't be framed, posts nowhere else, and loads no plugins", () => {
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "report-uri")).toEqual(["/api/csp-report"]);
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("lets only our own pages frame the chat, for the side panel", () => {
    expect(directive(pageCsp("/chat", "n", false), "frame-ancestors")).toEqual(["'self'"]);
    expect(directive(pageCsp("/chat/history", "n", false), "frame-ancestors")).toEqual(["'self'"]);
    expect(directive(pageCsp("/chatter", "n", false), "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(pageCsp("/home", "n", false), "frame-ancestors")).toEqual(["'none'"]);
    expect(CHAT_FRAME_HEADERS).toEqual([{ key: "X-Frame-Options", value: "SAMEORIGIN" }]);
  });

  it("relaxes only what local development needs", () => {
    const dev = contentSecurityPolicy({ nonce: "n", isDev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("gets a new, unguessable nonce every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, newNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(atob(nonce)).toHaveLength(16);
  });
});

describe("the other security headers", () => {
  it("send HSTS and the usual hardening headers in production", () => {
    expect(headerMap(false)).toEqual({
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": PERMISSIONS_POLICY,
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
      "X-Permitted-Cross-Domain-Policies": "none",
    });
  });

  it("keep the microphone for speaking to Jane, and turn off what Jane never uses", () => {
    const features = PERMISSIONS_POLICY.split(", ");
    expect(features).toContain("microphone=(self)");
    for (const off of ["camera=()", "geolocation=()", "payment=()", "usb=()"]) {
      expect(features).toContain(off);
    }
  });

  it("skip HSTS on plain-HTTP local development", () => {
    expect(headerMap(true)["Strict-Transport-Security"]).toBeUndefined();
  });

  it("let API responses load and frame nothing, and sandbox uploaded documents", () => {
    expect(API_CSP).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(DOCUMENT_FILE_CSP).toMatch(/^sandbox;/);
    expect(DOCUMENT_FILE_CSP).toContain("default-src 'none'");
    expect(DOCUMENT_FILE_CSP).not.toContain("script-src");
  });
});

describe("next.config.ts", () => {
  it("keeps Cache Components off, which the nonce needs", () => {
    // Prerendered shells carry build-time scripts without a nonce, which the policy blocks.
    expect(nextConfig.cacheComponents).toBe(false);
  });

  it("puts the API policy on API routes, then the documents' own after it", async () => {
    const rules = await nextConfig.headers!();
    const sources = rules.map((r) => r.source);
    expect(sources.indexOf("/api/documents/:documentId")).toBeGreaterThan(
      sources.indexOf("/api/:path*"),
    );
    // Pages get theirs from the proxy, with the nonce: never a second, fixed one.
    const all = rules.find((r) => r.source === "/:path*")!;
    expect(all.headers.map((h) => h.key)).not.toContain("Content-Security-Policy");
  });
});
