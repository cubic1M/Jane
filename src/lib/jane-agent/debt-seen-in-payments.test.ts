import { describe, expect, it } from "vitest";
import { debtBook } from "@/insights/debts";
import type { PaidLoan } from "@/insights/paid-loans";
import { debtsReply } from "./debt-replies";

// Debug 2 re-walk (11-16, a Chase checking statement paying Nelnet and Toyota Financial, the side
// chat at 1280 light): "how much do I owe?" answered with two bullets and nothing before them, then
// "I don't have a rate for …" though what's left wasn't known either. With only payments seen, it
// says so first, and names both missing figures.

const paid = (key: string, lender: string, kind: PaidLoan["kind"], cents: number): PaidLoan => ({
  key,
  lender,
  kind,
  paymentCents: cents,
  paymentsMade: 4,
  lastDate: "2026-11-05",
  nextDate: "2026-12-05",
});
const book = debtBook(
  {
    accounts: [],
    plans: [],
    typed: [],
    paid: [
      paid("student:nelnet", "Nelnet", "student", 21_740),
      paid("auto:toyota financial", "Toyota Financial", "auto", 34_512),
    ],
  },
  "2026-11-16",
);

describe("how much do I owe, with loans seen only in payments", () => {
  it("says first that Jane sees the payments, not what's left", () => {
    expect(debtsReply(book).body.split("\n")[0]).toBe(
      "I see your payments to 2 loans, not what's left on them.",
    );
  });

  it("asks for what's left and the rate, not the rate alone", () => {
    expect(debtsReply(book).body).toMatch(/I don't have what's left on or the rate of /);
  });
});
