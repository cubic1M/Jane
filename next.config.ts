import type { NextConfig } from "next";
import { hiddenRedirects } from "./src/config/hidden-pages";
import {
  API_CSP,
  CHAT_FRAME_HEADERS,
  DOCUMENT_FILE_CSP,
  securityHeaders,
} from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  // Off, for the nonce-based Content-Security-Policy (src/proxy.ts): a nonce must be new on every
  // request, and Cache Components' prerendered shells carry scripts made at build time, without
  // one, which the policy would block (the page wouldn't work). Every page renders per request
  // instead; docs/security/edge.md has the trade-off. Don't turn this on without changing the
  // policy: e2e/security-headers.spec.ts fails if a page's scripts lack the nonce.
  cacheComponents: false,
  // The dev-only "N" badge sits bottom-left, over the floating cards' buttons and inside the
  // side chat's frame; the error overlay still opens on an error.
  devIndicators: false,
  // Load Plaid's SDK as a plain Node package; bundled, its HTTP client picks a
  // browser adapter and every request fails without a response.
  serverExternalPackages: ["plaid"],
  experimental: {
    // CSV uploads go through server actions; the 1 MB default is too small for a
    // year of transactions. Matches MAX_FILE_BYTES in src/lib/import/import-csv.ts.
    serverActions: { bodySizeLimit: "5mb" },
  },
  // Pages the read-only beta can't use go to their area page (src/config/hidden-pages.ts).
  async redirects() {
    return hiddenRedirects();
  },
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    return [
      // Pages get their Content-Security-Policy from src/proxy.ts (it needs a fresh nonce).
      { source: "/:path*", headers: securityHeaders(isDev) },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
      // The side chat frames the chat's pages, from our own pages only.
      { source: "/chat", headers: CHAT_FRAME_HEADERS },
      { source: "/chat/:path*", headers: CHAT_FRAME_HEADERS },
      // Later entries win: uploaded documents get their own sandboxed policy (spec step 68).
      {
        source: "/api/documents/:documentId",
        headers: [{ key: "Content-Security-Policy", value: DOCUMENT_FILE_CSP }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
