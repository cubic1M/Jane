import { describe, expect, it } from "vitest";
import { debtBook } from "@/insights/debts";
import type { PaidLoan } from "@/insights/paid-loans";
import { debtsReply } from "./debt-replies";

// Debugger 11-16 (r319, a Chase checking upload paying Nelnet and Toyota Motor Credit, chat on a
// phone): after the person typed what's left on Nelnet, "how much do I owe on my loans?" opened
// "I see your payments to 2 loans, not what's left on them." and the next line was Nelnet's
// $18,400.00. The opener says which balances the person gave.

const paid = (key: string, lender: string, kind: PaidLoan["kind"], cents: number): PaidLoan => ({
  key,
  lender,
  kind,
  paymentCents: cents,
  paymentsMade: 4,
  lastDate: "2026-11-07",
  nextDate: "2026-12-07",
});
const loans = [
  paid("student:nelnet student loan", "Nelnet Student Loan", "student", 21_437),
  paid("auto:toyota motor credit", "Toyota Motor Credit", "auto", 33_812),
];
const typed = (debtKey: string) => ({
  debtKey,
  aprBps: 550,
  minimumPaymentCents: null,
  balanceCents: 1_840_000,
  payoffDate: null,
  updatedOn: "2026-11-16",
});
const opener = (keys: string[]) =>
  debtsReply(
    debtBook({ accounts: [], plans: [], typed: keys.map(typed), paid: loans }, "2026-11-16"),
  ).body.split("\n")[0];

describe("how much do I owe, after typing what's left on a loan", () => {
  it("says what's left is known on the one typed", () => {
    expect(opener(["paid:student:nelnet student loan"])).toBe(
      "I see your payments to 2 loans, and you told me what's left on 1 of them.",
    );
  });

  it("says so for all of them", () => {
    expect(opener(["paid:student:nelnet student loan", "paid:auto:toyota motor credit"])).toBe(
      "I see your payments to 2 loans, and you told me what's left on them.",
    );
  });

  it("is unchanged with nothing typed", () => {
    expect(opener([])).toBe("I see your payments to 2 loans, not what's left on them.");
  });
});
