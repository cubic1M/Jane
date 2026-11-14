import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// What a person sees or keeps as their own day, outside the pages (src/app/person-today.test.ts)
// and the area pages (src/lib/area-pages/person-today.test.ts): each took "today" from the UTC
// clock, a day ahead in a US evening (debugger 11-13). A proposal's month, an overdraft "this
// month", a mortgage's months left, the year in review, the long view's age, a W-4 change's day,
// when Jane last asked, a checklist's start, the tax year a form saves to, an upload's "old".

const SRC = join(__dirname, "..");
const PERSON_DAYS = [
  "lib/questions.ts",
  "lib/proposals.ts",
  "lib/debt-decisions.ts",
  "lib/mortgage.ts",
  "lib/tax-withholding.ts",
  "lib/multi-year.ts",
  "lib/year.ts",
  "lib/life-events.ts",
  "app/taxes/profile/actions.ts",
  "app/import/import-form.tsx",
];
const UTC_TODAY = /\b(?:new Date\(\)|now)\.toISOString\(\)\.slice\(0, 10\)/;

describe("a person's own day, outside the pages", () => {
  it("is never taken from the UTC clock", () => {
    const offenders = PERSON_DAYS.filter((f) => UTC_TODAY.test(readFileSync(join(SRC, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
