import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Tax T32b: who still reads a 2026 figure from the frozen shims in src/config/tax-rates.ts instead of
// the year's own parameters (`federalParams(year)`). A figure shown for a calendar year must come
// from that year's law; these files do not yet, and the list only gets shorter: a new reader of a
// shim is a failing test (use `federalParams(year)`), and a file moved to the year's parameters must
// leave the list.
//
// Of these figures the ones indexed every year differ in 2027 and are the follow-up work:
// CONTRIBUTION_LIMITS (401(k), IRA, HSA, FSA), STANDARD_DEDUCTION, FEDERAL_BRACKETS,
// CAPITAL_GAINS_BRACKETS, SELF_EMPLOYMENT_TAX (the wage base), SAVERS_CREDIT and ITEMIZED.saltCap.
// The rest are statutory and not indexed (the home office rate, the education credits, the care
// credit, the payroll rates, the OBBBA deductions), so they are the same in 2027.
const SHIMS = [
  "FEDERAL_BRACKETS",
  "STANDARD_DEDUCTION",
  "ADDITIONAL_STANDARD_65",
  "CAPITAL_GAINS_BRACKETS",
  "CAPITAL_LOSS_LIMIT",
  "CONTRIBUTION_LIMITS",
  "DEPENDENT_CARE_CREDIT",
  "EDUCATION_CREDITS",
  "STUDENT_LOAN_INTEREST",
  "SELF_EMPLOYMENT_TAX",
  "PAYROLL_TAX",
  "ITEMIZED",
  "SAVERS_CREDIT",
  "SAVERS_MATCH",
  "OBBBA_DEDUCTIONS",
  "ROTH_CATCH_UP",
  "QBI",
  "HOME_OFFICE_SIMPLIFIED",
];

const KNOWN: readonly string[] = [
  "app/taxes/self-employed/page.tsx: HOME_OFFICE_SIMPLIFIED",
  "config/learn.ts: CONTRIBUTION_LIMITS, STANDARD_DEDUCTION",
  "detectors/savers-credit.ts: SAVERS_MATCH",
  "detectors/student-credits.ts: EDUCATION_CREDITS",
  "detectors/taxes.ts: DEPENDENT_CARE_CREDIT, HOME_OFFICE_SIMPLIFIED, PAYROLL_TAX",
  "lib/tax-decisions.ts: HOME_OFFICE_SIMPLIFIED",
  "planning/audit-records.ts: ITEMIZED",
  "planning/family-taxes.ts: DEPENDENT_CARE_CREDIT, EDUCATION_CREDITS, PAYROLL_TAX",
  "planning/health-taxes.ts: ITEMIZED",
  "planning/home-taxes.ts: HOME_OFFICE_SIMPLIFIED",
  "planning/obbba-deductions.ts: OBBBA_DEDUCTIONS, ROTH_CATCH_UP",
  "planning/self-employed.ts: HOME_OFFICE_SIMPLIFIED",
  "planning/tax-savings.ts: DEPENDENT_CARE_CREDIT, EDUCATION_CREDITS, ITEMIZED, PAYROLL_TAX",
  "planning/tax-states.ts: STANDARD_DEDUCTION",
];

const root = join(process.cwd(), "src");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : files(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [path] : [];
  });
}

describe("readers of the frozen 2026 shims in tax-rates.ts", () => {
  it("are exactly the known list, which only gets shorter", () => {
    const found: string[] = [];
    for (const path of files(root)) {
      const relative = path.slice(root.length + 1);
      if (relative === "config/tax-rates.ts") continue;
      const text = readFileSync(path, "utf8");
      for (const m of text.matchAll(
        /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"(?:@\/config\/|\.\/)tax-rates"/g,
      )) {
        const names = (m[1] ?? "")
          .split(",")
          .map(
            (x) =>
              x
                .trim()
                .replace(/^type\s+/, "")
                .split(/\s+as\s+/)[0] ?? "",
          )
          .filter((n) => SHIMS.includes(n));
        if (names.length > 0) found.push(`${relative}: ${names.sort().join(", ")}`);
      }
    }
    expect(found.sort()).toEqual([...KNOWN].sort());
  });
});
