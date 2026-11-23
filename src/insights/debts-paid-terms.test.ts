import { describe, expect, it } from "vitest";
import { debtBook, type DebtAccountInput } from "./debts";
import type { PaidLoan } from "./paid-loans";

// Plaid + loans (desktop sweeps 7 to 18): the bank reports a car loan with no payment of its own
// (Plaid's Liabilities covers no car loans), and checking pays Toyota Financial $345.12 on the
// 9th. That loan takes its payment and next date from the payments, when they show the one loan of
// its kind and the bank reports one too; it was "no date" before.

const AS_OF = "2026-11-20";
const loan = (id: string, subtype: string, minimum: number | null = null): DebtAccountInput => ({
  id,
  name: `Plaid ${subtype} loan`,
  mask: null,
  type: "loan",
  subtype,
  currentBalanceCents: 1_288_000,
  liability:
    minimum === null
      ? null
      : {
          aprBps: null,
          rateType: null,
          minimumPaymentCents: minimum,
          nextPaymentDueDate: null,
          payoffDate: null,
          isOverdue: null,
          pastDueCents: null,
          description: null,
        },
});
const paid = (lender: string, kind: PaidLoan["kind"], cents = 34_512): PaidLoan => ({
  key: `${kind}:${lender.toLowerCase()}`,
  lender,
  kind,
  paymentCents: cents,
  paymentsMade: 4,
  lastDate: "2026-11-09",
  nextDate: "2026-12-09",
});
const book = (accounts: DebtAccountInput[], loans: PaidLoan[]) =>
  debtBook({ accounts, plans: [], typed: [], paid: loans }, AS_OF);

describe("a bank-reported loan with no payment of its own", () => {
  it("takes the payment and next date from the payments from checking", () => {
    const [car] = book([loan("car", "auto")], [paid("Toyota Financial", "auto")]).debts;
    expect(car).toMatchObject({
      key: "account:car",
      paymentCents: 34_512,
      paymentFrom: "payments",
      nextDue: "2026-12-09",
    });
    // One debt, not the account and the payments both.
    expect(book([loan("car", "auto")], [paid("Toyota Financial", "auto")]).debts).toHaveLength(1);
  });

  it("keeps the bank's own payment, and takes none from another kind of loan", () => {
    expect(
      book([loan("car", "auto", 25_000)], [paid("Toyota Financial", "auto")]).debts[0],
    ).toMatchObject({ paymentCents: 25_000, paymentFrom: "bank", nextDue: null });
    expect(
      book([loan("student", "student")], [paid("Toyota Financial", "auto")]).debts.find(
        (d) => d.key === "account:student",
      ),
    ).toMatchObject({ paymentCents: null, nextDue: null });
  });

  it("takes none when the payments can't say which loan is which", () => {
    const debts = book(
      [loan("car", "auto")],
      [paid("Toyota Financial", "auto"), paid("Ally Auto", "auto", 41_000)],
    ).debts;
    expect(debts.find((d) => d.key === "account:car")).toMatchObject({
      paymentCents: null,
      nextDue: null,
    });
  });
});
