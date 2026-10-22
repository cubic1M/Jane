import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The market history load runs on the Vercel schedule, so the real price history arrives and
// stays current without anyone handling the cron secret.
describe("market history schedule", () => {
  it("runs the load once a day", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const cron = config.crons.find((c) => c.path === "/api/cron/market-history");
    expect(cron?.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });
});
