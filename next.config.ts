import type { NextConfig } from "next";
import { DOCUMENT_FILE_CSP, chatFrameHeaders, securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Load Plaid's SDK as a plain Node package; bundled, its HTTP client picks a
  // browser adapter and every request fails without a response.
  serverExternalPackages: ["plaid"],
  partialPrefetching: true,
  experimental: {
    // CSV uploads go through server actions; the 1 MB default is too small for a
    // year of transactions. Matches MAX_FILE_BYTES in src/lib/import/import-csv.ts.
    serverActions: { bodySizeLimit: "5mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders(process.env.NODE_ENV === "development") },
      // The side chat frames the chat's pages, from our own pages only.
      { source: "/chat", headers: chatFrameHeaders(process.env.NODE_ENV === "development") },
      { source: "/chat/:path*", headers: chatFrameHeaders(process.env.NODE_ENV === "development") },
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
