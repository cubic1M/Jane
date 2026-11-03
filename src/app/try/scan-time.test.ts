import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Debugger 11-03: "Try Jane" runs its first scan after the response, inside the limit of the page the
// form is on. Production's logs had the first brief in at 21-23 seconds, then "Task timed out after 60
// seconds": card explanations, Jane's last message and the numbers saved for the chat never came.
const secondsOn = (page: string) =>
  Number(readFileSync(page, "utf8").match(/export const maxDuration = (\d+)/)?.[1] ?? 0);

describe("the time the sample person's first scan gets", () => {
  it("is as long as the daily jobs get, on the page with the form", () => {
    expect(secondsOn("src/app/page.tsx")).toBe(secondsOn("src/app/api/cron/plaid-sync/route.ts"));
    expect(secondsOn("src/app/page.tsx")).toBeGreaterThanOrEqual(300);
  });
});
