import { defineConfig } from "@playwright/test";

// The browser's half of the pre-traffic journeys, against a deployed candidate with no database of
// its own to seed: docs/ops.md. CANDIDATE_URL is required, and it never starts a server.
const bypass = process.env.VERCEL_BYPASS;

export default defineConfig({
  testDir: "./candidate",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: process.env.CANDIDATE_URL,
    extraHTTPHeaders: bypass
      ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }
      : {},
  },
});
