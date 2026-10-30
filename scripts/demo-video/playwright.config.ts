import { defineConfig } from "@playwright/test";
import { DEMO_AUTH_SECRET, DEMO_PORT, demoDatabaseUrl } from "./settings";

// The demo video's own Playwright run (./README.md): a production build on the scratch
// database, one worker, no retries. Not part of the e2e suite; CI never runs it.
const database = demoDatabaseUrl();

export default defineConfig({
  testDir: ".",
  testMatch: "record.spec.ts",
  workers: 1,
  retries: 0,
  // Generous: a busy machine records slower.
  timeout: 900_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  outputDir: "../../test-results/demo-video",
  use: { baseURL: `http://localhost:${DEMO_PORT}` },
  webServer: {
    command: `npm run start -- -p ${DEMO_PORT}`,
    cwd: "../..",
    url: `http://localhost:${DEMO_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: database,
      DIRECT_URL: database,
      AUTH_SECRET: DEMO_AUTH_SECRET,
      AUTH_URL: `http://localhost:${DEMO_PORT}`,
      AUTH_TRUST_HOST: "true",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      // No Claude call, no email, no analytics, no price service: nothing leaves the machine.
      ANTHROPIC_API_KEY: "",
      RESEND_API_KEY: "",
      POSTHOG_KEY: "",
      PAPER_SAMPLE_PRICES: "1",
      EVENTS_REFRESH: "off",
      // What the e2e production build turns on, so the build is the same one.
      DEMO_BANK: "1",
      TRY_JANE: "1",
      DEMO_ADVICE: "1",
      SIMULATED_AGENT: "1",
    },
  },
});
