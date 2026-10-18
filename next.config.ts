import type { NextConfig } from "next";

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
