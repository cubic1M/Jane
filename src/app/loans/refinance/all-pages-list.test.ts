import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Debug 2 re-walk (11-16, the S6 student on a build with #1909): Loans' folded "All loans and
// credit pages" list still linked "See refinance offers". With no lending partner that page sends
// the person straight back to Loans, so the list doesn't offer it then (like the Refinance link
// and the "Checked monthly" item since #1909).

const loans = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");
const list = loans.slice(loans.indexOf('aria-label="All loans and credit pages"'));

describe("Loans' list of every page, without a lending partner", () => {
  it("leaves refinance out", () => {
    expect(list).toMatch(/refinanceOpen \|\| p\.href !== REFINANCE_HREF/);
  });
});
