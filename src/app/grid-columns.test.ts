import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A grid that becomes columns only from a breakpoint ("grid gap-3 sm:grid-cols-2") has one
// implicit auto column below it, as wide as its widest field: on a phone a form's labels and
// Save ran 8px off the screen (debugger 10-30, /things). Such a grid says grid-cols-1
// (minmax(0, 1fr)) for the phone too.

const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe("grids that gain columns at a breakpoint", () => {
  it("say grid-cols-1 for a phone", () => {
    const bad: string[] = [];
    for (const file of [...files(join(SRC, "app")), ...files(join(SRC, "components"))]) {
      for (const [, classes] of readFileSync(file, "utf8").matchAll(/className="([^"]*)"/g)) {
        const words = classes.split(/\s+/);
        if (!words.includes("grid")) continue;
        const atBreakpoint = words.some((w) => /^(sm|md|lg|xl):grid-cols-/.test(w));
        const base = words.some((w) => /^grid-cols-/.test(w));
        if (atBreakpoint && !base) bad.push(`${relative(SRC, file)}: "${classes}"`);
      }
    }
    expect(bad).toEqual([]);
  });
});
