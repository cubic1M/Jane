import { describe, expect, it } from "vitest";
import { categorizeByRules } from "./rules";

// Debugger 11-14, from the simplify pass's look at income kinds: the salary rule's "DIR DEP" came
// before the Social Security and pension rules, so a retiree's "SSA TREAS 310 XXSOC SEC DIR DEP"
// and "CALPERS RETIREMENT DIR DEP" read as a salary, and military retired pay as military pay. The
// profile then saw a job, and the tax estimate wages, where there was a pension.

const categoryOf = (description: string) =>
  categorizeByRules({ description, amountCents: -150_000, hints: {} } as never)?.detailed ?? null;

describe("money paid for having retired", () => {
  it.each([
    "SSA TREAS 310 XXSOC SEC DIR DEP",
    "US TREASURY 310 XXSOC SEC",
    "SOCIAL SECURITY DIRECT DEP",
    "CALPERS RETIREMENT DIR DEP",
    "OPM1 TREAS 310 CSA ANNUITY DIR DEP",
    "PENSION DIRECT DEPOSIT",
    "DFAS-CLEVELAND RET NET PAY",
  ])("is a pension, not a salary: %s", (description) => {
    expect(categoryOf(description)).toBe("INCOME_RETIREMENT_PENSION");
  });

  it("leaves pay, military pay and benefits as they were", () => {
    expect(categoryOf("ACME CORP DIR DEP")).toBe("INCOME_SALARY");
    expect(categoryOf("DFAS-CLEVELAND MIL PAY")).toBe("INCOME_MILITARY");
    expect(categoryOf("SSI TREAS 310 XXSUPP SEC DIR DEP")).toBe("INCOME_LONG_TERM_DISABILITY");
    expect(categoryOf("VA TREAS 310 XXVA BENEFIT DIR DEP")).toBe("INCOME_LONG_TERM_DISABILITY");
  });
});
