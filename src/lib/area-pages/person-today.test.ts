import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The pages' guard (src/app/person-today.test.ts) looks at page.tsx files; the area pages and the
// hubs build their trees in src/lib, where Loans, Insurance, Taxes and the Ahead hub each took
// "today" from the UTC clock (debugger 11-13): at 7pm in Los Angeles a deadline was a day nearer
// and, on Apr 30, the tax year gathered moved on early. Their today is the person's (todayOf).

const DIRS = [join(__dirname), join(__dirname, "..", "hubs")];
const UTC_TODAY = /\b(?:new Date\(\)|now)\.toISOString\(\)\.slice\(0, 10\)/;

describe("area pages and hubs use the person's day", () => {
  it("none takes today from the UTC clock", () => {
    const offenders = DIRS.flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
        .filter((name) => UTC_TODAY.test(readFileSync(join(dir, name), "utf8")))
        .map((name) => `${dir.endsWith("hubs") ? "hubs" : "area-pages"}/${name}`),
    );
    expect(offenders).toEqual([]);
  });
});
