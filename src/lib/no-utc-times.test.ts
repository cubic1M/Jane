import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Debugger 11-14: the investing page's events box said "last checked Nov 13, 5:37 PM UTC" to
// someone in Los Angeles, the Robinhood box "Last updated … UTC" and /security's recent activity
// "2026-11-14 06:40 UTC". A time shown to the person is their own (momentTimeLabel in
// src/lib/moment-time.ts), never UTC with "UTC" after it.

const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

// Shown only to admins, or on a page hidden in the beta (/actions, src/config/hidden-pages.ts).
const NOT_THE_PERSONS = new Set(["components/agent-timeline.tsx"]);

describe("a time on a page", () => {
  it("is never labelled UTC", () => {
    const bad = [join(SRC, "app"), join(SRC, "components")]
      .flatMap(files)
      .map((file) => relative(SRC, file))
      .filter((file) => !file.includes("/admin/") && !NOT_THE_PERSONS.has(file))
      .flatMap((file) =>
        readFileSync(join(SRC, file), "utf8")
          .split("\n")
          .flatMap((line, i) =>
            / UTC[`".]/.test(line) && !line.trim().startsWith("//") ? [`${file}:${i + 1}`] : [],
          ),
      );
    expect(bad).toEqual([]);
  });
});
