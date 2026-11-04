import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Holdout scenarios: see README.md here. Never starts a server, and only ever talks to a local one.
const baseURL = process.env.HOLDOUT_URL;
if (!baseURL) throw new Error("Set HOLDOUT_URL to the running build, e.g. http://localhost:4120");
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) {
  throw new Error("Holdouts make people and delete them: run them on a local server only.");
}

export default defineConfig({
  testDir: ".", // this folder, holdouts/
  testMatch: "*.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["line"],
    ["json", { outputFile: path.resolve(process.cwd(), "holdouts-results.json") }],
  ],
  outputDir: path.resolve(process.cwd(), "test-results/holdouts"),
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
});
