import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The person's own day (founder, 2026-10-23; src/lib/today.ts): a page's "today", "this month"
// and "days left" are the person's, not UTC's. /budgets said "29 days left this month" at 10:30pm
// on Oct 31 in Los Angeles, because it took the date from the UTC clock (debugger 11-01). Admin
// pages are the team's and stay in UTC.

const APP = join(__dirname);

function pageFiles(dir = APP, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "admin") pageFiles(p, out);
    } else if (name === "page.tsx") out.push(p);
  }
  return out;
}

// Today from the clock in UTC: `new Date().toISOString().slice(0, 10)`, or the same through a
// `now` that is `new Date()`.
const UTC_TODAY = /\b(?:new Date\(\)|now)\.toISOString\(\)\.slice\(0, 10\)/;

describe("pages use the person's day", () => {
  it("no page takes today from the UTC clock", () => {
    const offenders = pageFiles()
      .filter((f) => UTC_TODAY.test(readFileSync(f, "utf8")))
      .map((f) => relative(APP, f));
    expect(offenders).toEqual([]);
  });
});
