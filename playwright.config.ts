import { defineConfig, devices } from "@playwright/test";
import { E2E_AUTH_SECRET } from "./e2e/db";

// E2E_PORT lets several checkouts run the end-to-end tests at once.
const PORT = Number(process.env.E2E_PORT ?? 3000);

// Signed-in tests need a scratch database (see e2e/db.ts); the dev server gets it too.
const scratchDatabase = process.env.E2E_DATABASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  // The dev server compiles each page on its first visit, which can take several seconds.
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    // A running server may be pointed at another database, so never reuse one for
    // signed-in tests.
    reuseExistingServer: !process.env.CI && !scratchDatabase,
    timeout: 120_000,
    env: scratchDatabase
      ? {
          DATABASE_URL: scratchDatabase,
          DIRECT_URL: scratchDatabase,
          AUTH_SECRET: E2E_AUTH_SECRET,
          // A fixed test-only key for encrypting secrets (admin two-factor, Plaid tokens).
          TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
          ANTHROPIC_API_KEY: "",
          RESEND_API_KEY: "",
        }
      : {},
  },
});
