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
// A helper whose body formats a date in UTC: an arrow `const x = (…) => …` or a `function x(…)`.
const UTC_HELPERS = [
  /const\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]+)?=>[^;]{0,300}?toLocale(?:Date)?String\([^)]*timeZone:\s*"UTC"/g,
  /function\s+(\w+)\s*\([^)]*\)[^{]*\{[^}]{0,300}?toLocale(?:Date)?String\([^)]*timeZone:\s*"UTC"/g,
];

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
        for (const [match] of text.matchAll(call)) bad.push(`${relative(SRC, file)}: ${match}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
