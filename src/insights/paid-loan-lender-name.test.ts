import { describe, expect, it } from "vitest";
import { debtBook } from "./debts";
import { lenderName, paidLoans, type PaidLoanPayment } from "./paid-loans";

// Debugger 11-19 (r362, upload S6 on a phone: 14 months of Wells Fargo checking): Nelnet's line
// "NELNET LOAN PAYMENT STUDENT LN" named the loan "Nelnet Loan Payment Student Ln" on Home ("Not
// counting what you owe on …"), on Loans and in the chat ("Your Nelnet Loan Payment Student Ln: I
// don't know what's left on it"). The bank's words for the payment aren't the lender's name.

const AS_OF = "2026-11-19";
const months = ["2026-08-15", "2026-09-15", "2026-10-15"];
const paid = (description: string, pfcDetailed: string) =>
  months.map(
    (date) =>
      ({
        date,
        amountCents: 21_040,
        description,
        merchantName: null,
        pfcDetailed,
      }) satisfies PaidLoanPayment,
  );
const nameOf = (description: string, pfcDetailed: string) =>
  debtBook(
    { accounts: [], plans: [], typed: [], paid: paidLoans(paid(description, pfcDetailed), AS_OF) },
    AS_OF,
  ).debts.map((d) => d.name);

describe("a loan seen in payments, by its lender's name", () => {
  it.each([
    ["NELNET LOAN PAYMENT STUDENT LN", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT", "Nelnet student loan"],
    ["NAVIENT STUDENT LN PMT", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT", "Navient student loan"],
    ["ALLY AUTO PAYMENT", "LOAN_PAYMENTS_CAR_PAYMENT", "Ally car loan"],
  ])("%s is %s", (description, category, name) => {
    expect(nameOf(description, category)).toEqual([name]);
  });

  it("keeps a lender's own name when no payment word follows it", () => {
    expect(nameOf("PENNYMAC LOAN SERVICES", "LOAN_PAYMENTS_MORTGAGE_PAYMENT")).toEqual([
      "Pennymac Loan Services mortgage",
    ]);
  });

  it("is how Home's net worth names a loan it leaves out", () => {
    expect(lenderName("Nelnet Loan Payment Student Ln")).toBe("Nelnet");
    expect(lenderName("Toyota Motor Credit")).toBe("Toyota Motor Credit");
  });
});
