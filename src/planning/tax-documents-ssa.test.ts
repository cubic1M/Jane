import { describe, expect, it } from "vitest";
import { expectedForms, type FormTransaction } from "./tax-documents";

// CodeRabbit sweep 1b: Social Security deposits under two payer names made two SSA-1099 forms
// with the same key, each with part of the year.
const pay = (description: string, date: string): FormTransaction => ({
  date,
  amountCents: -100_000,
  pfcDetailed: "INCOME_RETIREMENT_PENSION",
  description,
  merchantName: null,
  accountName: "Checking",
});

describe("Social Security under two payer names", () => {
  it("is one form with the year's total", () => {
    const forms = expectedForms({
      year: 2026,
      transactions: [pay("SSA TREAS 310", "2026-09-03"), pay("SOCIAL SECURITY", "2026-10-03")],
      accounts: [],
      loans: [],
    });
    expect(forms.map((f) => [f.form, f.amountCents])).toEqual([["SSA-1099", 200_000]]);
  });
});
