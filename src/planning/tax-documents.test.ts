import { describe, expect, it } from "vitest";
import { expectedForms, type FormTransaction } from "./tax-documents";

// Spec step 119: the tax forms to expect, from payers and lenders.

const tx = (o: Partial<FormTransaction>): FormTransaction => ({
  date: "2026-03-01",
  amountCents: -100_000,
  pfcDetailed: "INCOME_SALARY",
  description: "ACME CORP PAYROLL",
  merchantName: null,
  accountName: "Checking",
  ...o,
});

describe("expectedForms", () => {
  const forms = expectedForms({
    year: 2026,
    transactions: [
      tx({}),
      tx({ date: "2026-04-01" }),
      // Last year's pay doesn't count for 2026.
      tx({ date: "2025-12-15", description: "OLD JOB PAYROLL" }),
      tx({ pfcDetailed: "INCOME_CONTRACTOR", merchantName: "Big Client", amountCents: -250_000 }),
      tx({ pfcDetailed: "INCOME_GIG_ECONOMY", merchantName: "Uber", amountCents: -50_000 }),
      tx({
        pfcDetailed: "INCOME_INTEREST_EARNED",
        description: "INTEREST",
        amountCents: -1_200,
        accountName: "High Yield Savings",
      }),
      tx({
        pfcDetailed: "INCOME_INTEREST_EARNED",
        description: "INTEREST",
        amountCents: -500,
        accountName: "Checking",
      }),
      tx({
        pfcDetailed: "INCOME_UNEMPLOYMENT",
        description: "EDD UI BENEFITS",
        amountCents: -40_000,
      }),
    ],
    accounts: [
      { name: "Brokerage", type: "investment", subtype: "brokerage" },
      { name: "401k", type: "investment", subtype: "401k" },
    ],
    loans: [
      { name: "Home Loan", kind: "mortgage", ytdInterestPaidCents: 1_023_040 },
      { name: "Student Loan", kind: "student", ytdInterestPaidCents: 80_550 },
      { name: "Small Student Loan", kind: "student", ytdInterestPaidCents: 50_000 },
      { name: "Car", kind: "loan", ytdInterestPaidCents: 100_000 },
    ],
  });

  it("expects one form per payer and lender, by the usual date the year after", () => {
    expect(forms.map((f) => [f.key, f.form, f.from, f.by])).toEqual([
      ["w2:acme-corp-payroll", "W-2", "ACME CORP PAYROLL", "2027-01-31"],
      ["nec:big-client", "1099-NEC or 1099-K", "Big Client", "2027-01-31"],
      ["nec:uber", "1099-NEC or 1099-K", "Uber", "2027-01-31"],
      ["g:edd-ui-benefits", "1099-G", "EDD UI BENEFITS", "2027-01-31"],
      ["int:high-yield-savings", "1099-INT", "High Yield Savings", "2027-01-31"],
      ["brokerage:brokerage", "consolidated 1099 (DIV and B)", "Brokerage", "2027-02-15"],
      ["mortgage:home-loan", "1098", "Home Loan", "2027-01-31"],
      ["student:student-loan", "1098-E", "Student Loan", "2027-01-31"],
    ]);
  });

  it("marks a freelance payer under the 2026 threshold ($2,000) as maybe not sending one", () => {
    expect(forms.find((f) => f.key === "nec:big-client")).toMatchObject({
      mayNotSend: false,
      amountCents: 250_000,
    });
    expect(forms.find((f) => f.key === "nec:uber")).toMatchObject({
      mayNotSend: true,
      amountCents: 50_000,
    });
  });

  it("for a past year, still expects the loan interest forms, amount unknown", () => {
    const forms = expectedForms({
      year: 2025,
      transactions: [],
      accounts: [],
      loans: [
        { name: "Home Loan", kind: "mortgage", ytdInterestPaidCents: null },
        { name: "Car", kind: "loan", ytdInterestPaidCents: null },
      ],
    });
    expect(forms).toEqual([
      expect.objectContaining({ key: "mortgage:home-loan", form: "1098", amountCents: null }),
    ]);
  });

  it("uses each year's threshold: $600 for 2025", () => {
    const [form] = expectedForms({
      year: 2025,
      transactions: [
        tx({
          date: "2025-06-01",
          pfcDetailed: "INCOME_CONTRACTOR",
          merchantName: "Uber",
          amountCents: -70_000,
        }),
      ],
      accounts: [],
      loans: [],
    });
    expect(form).toMatchObject({ key: "nec:uber", mayNotSend: false, by: "2026-01-31" });
  });
});
