import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The moment-labels guard (./moment-labels.test.ts) sees a moment read in UTC where it's written
// out. A file's own helper hid it: `const day = (d: Date) => d.toLocaleDateString(..., timeZone:
// "UTC")`, then `day(t.placedAt)`. Five did (debugger 11-13, from the simplify pass: a quote's
// "Good until", the practice log's days and times, a life offer's end, a finished checklist).
// Here a helper that formats in UTC may take days, never moments.

const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.includes("generated")
      ? [path]
      : [];
  });
}

// A moment's name, as the guard has it: createdAt, placedAt, offerExpiresAt, a row's .at.
const MOMENT = String.raw`[\w.]*(?:[a-z]At|\.at)\b`;
// Reading a date in UTC: a toLocale…String that says so, dayLabel (a calendar day's label), or
// a cut to "YYYY-MM-DD" (debugger 11-14: settings' `day = (d) => dayLabel(d, …)` said a file
// imported at 10:40pm in Los Angeles was imported the next day, and the chat's settings tool cut
// the same moments with toISOString().slice(0, 10)).
const UTC_READ = String.raw`(?:toLocale(?:Date)?String\([^)]*timeZone:\s*"UTC"|\bdayLabel\(|toISOString\(\)\.slice\(0, 10\)|\bisoDay\()`;
// A helper whose body reads a date in UTC: an arrow `const x = (…) => …` or a `function x(…)`.
const UTC_HELPERS = [
  new RegExp(String.raw`const\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]+)?=>[^;]{0,300}?${UTC_READ}`, "g"),
  new RegExp(String.raw`function\s+(\w+)\s*\([^)]*\)[^{]*\{[^}]{0,300}?${UTC_READ}`, "g"),
];
// Moments that are rightly read as UTC days, with why.
const UTC_DAYS = new Set([
  // The events overlay's own calendar: when its switch was turned on, against price days, which
  // are UTC calendar days (docs/backtests/events.md). Never shown as the person's day.
  "lib/events/run.ts: dayOf(overlay.switchedAt",
]);

describe("a file's own UTC date helper", () => {
  it("is never given a moment", () => {
    const bad: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, "utf8");
      const helpers = new Set(
        UTC_HELPERS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1]!)),
      );
      for (const name of helpers) {
        const call = new RegExp(String.raw`\b${name}\((?:new Date\()?${MOMENT}`, "g");
        for (const [match] of text.matchAll(call)) {
          const where = `${relative(SRC, file)}: ${match}`;
          if (!UTC_DAYS.has(where)) bad.push(where);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
