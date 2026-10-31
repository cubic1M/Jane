import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A moment (createdAt, uploadedAt, a note's at) is labelled with the person's own day
// (momentLabel), never read in UTC: at 9pm in Los Angeles an upload made tonight read "added"
// tomorrow (debugger 10-30, /import). Calendar days ("YYYY-MM-DD", a transaction's date) stay in
// UTC through dayLabel.

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

// A moment's name: createdAt, uploadedAt, lastViewedAt, a row's .at.
const MOMENT = String.raw`[\w.]*(?:[a-z]At|\.at)\b`;
// Read in UTC: through dayLabel, or a toLocale…String that says timeZone "UTC".
const UTC_READS = [
  new RegExp(String.raw`dayLabel\((?:new Date\()?${MOMENT}`, "g"),
  new RegExp(String.raw`${MOMENT}\.toLocale(?:Date)?String\([^)]*timeZone: "UTC"`, "g"),
];
// On a page, a moment cut to its UTC day ("2026-10-31"): both the wrong day and a raw date.
const PAGE_UTC_READS = [
  new RegExp(String.raw`${MOMENT}(?:\.toISOString\(\))?\.slice\(0, 10\)`, "g"),
];
const isPage = (file: string) =>
  /\.tsx$/.test(file) && !file.includes("/admin/") && /\/(app|components)\//.test(file);

// Named like moments but days: an option's price check is the day an admin typed, kept at UTC
// midnight (src/app/admin/options/actions.ts).
const DAYS = new Set(["app/report/[findingId]/best-option.tsx: dayLabel(option.checkedAt"]);

describe("moments read as the person's day", () => {
  it("are never labelled in UTC", () => {
    const bad: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const read of [...UTC_READS, ...(isPage(file) ? PAGE_UTC_READS : [])])
        for (const [match] of text.matchAll(read)) {
          const where = `${relative(SRC, file)}: ${match}`;
          if (!DAYS.has(where)) bad.push(where);
        }
    }
    expect(bad).toEqual([]);
  });
});
