import { describe, expect, it } from "vitest";
import { expectedForms, type FormTransaction } from "./tax-documents";

// Debug 2 re-walk (11-16, Plaid sandbox default user, 1280 light): Taxes' "Forms to expect" listed
// "W-2 from Sweetgreen inc payroll ppd id" and "W-2 from Sweetgreen": every paycheck had the same
// words, and the bank only named the payer from October on. One employer sends one W-2.

const pay = (date: string, merchantName: string | null): FormTransaction => ({
  date,
  amountCents: -81_000,
  pfcDetailed: "INCOME_SALARY",
  description: "Sweetgreen inc payroll ppd id",
  merchantName,
  accountName: "Plaid checking",
});

describe("a payer the bank names partway through the year", () => {
  it("is one W-2, under the bank's name, with all of its pay", () => {
    const forms = expectedForms({
      year: 2026,
      transactions: [
        pay("2026-05-23", null),
        pay("2026-09-26", null),
        pay("2026-10-10", null),
        pay("2026-10-17", "Sweetgreen"),
        pay("2026-11-14", "Sweetgreen"),
      ],
      accounts: [],
      loans: [],
    }).filter((f) => f.formKey === "w2");
    expect(forms.map((f) => [f.from, f.amountCents])).toEqual([["Sweetgreen", 405_000]]);
  });

  it("leaves a payer unnamed when the same words carry two names", () => {
    const forms = expectedForms({
      year: 2026,
      transactions: [
        pay("2026-05-23", null),
        pay("2026-10-17", "Sweetgreen"),
        pay("2026-11-14", "Sweetgreen West"),
      ],
      accounts: [],
      loans: [],
    }).filter((f) => f.formKey === "w2");
    expect(forms.map((f) => f.from).sort()).toEqual([
      "Sweetgreen",
      "Sweetgreen West",
      "Sweetgreen inc payroll ppd id",
    ]);
  });
});
