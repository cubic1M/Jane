import { describe, expect, it } from "vitest";
import { debtBook, type DebtAccountInput } from "@/insights/debts";
import type { BnplPlan } from "@/insights/bnpl";
import { debtDetailReply, debtsReply } from "./debt-replies";

// Spec step 109: Jane's answers about debts, every rate with where it came from.
const AS_OF = "2026-10-19";
const l = (over: Partial<NonNullable<DebtAccountInput["liability"]>>) => ({
  aprBps: null,
  rateType: null,
  minimumPaymentCents: null,
  nextPaymentDueDate: null,
  payoffDate: null,
  isOverdue: null,
  pastDueCents: null,
  description: null,
  ...over,
});
const CAR: DebtAccountInput = {
  id: "car",
  name: "Demo Car Loan",
  mask: "0006",
  type: "loan",
  subtype: "auto",
  currentBalanceCents: 1_802_000,
  liability: l({
    aprBps: 690,
    rateType: "fixed",
    minimumPaymentCents: 49_410,
    nextPaymentDueDate: new Date("2026-11-01"),
    payoffDate: new Date("2029-10-01"),
  }),
};
const CARD: DebtAccountInput = {
  id: "card",
  name: "Demo Credit Card",
  mask: "0003",
  type: "credit",
  subtype: "credit card",
  currentBalanceCents: 241_050,
  liability: l({ aprBps: 2299, minimumPaymentCents: 3500, isOverdue: true, pastDueCents: 3500 }),
};
const AFFIRM: BnplPlan = {
  key: "affirm:8950",
  provider: "affirm",
  providerName: "Affirm",
  kind: "monthly",
  paymentCents: 8950,
  paymentsMade: 5,
  firstDate: "2026-06-01",
  lastDate: "2026-10-01",
  nextDate: "2026-10-31",
  paymentsLeft: null,
  balanceCents: null,
  payoffDate: null,
};
const book = (accounts = [CAR, CARD], plans = [AFFIRM]) =>
  debtBook({ accounts, plans, typed: [] }, AS_OF);

describe("how much do I owe", () => {
  it("gives the total net worth counts, the plans on top and every debt", () => {
    const reply = debtsReply(book());
    expect(reply.body.split("\n")).toEqual([
      "You owe $20,430.50 on 2 loans and cards, the same as your net worth counts.",
      "Plus 1 buy now, pay later plan (1 without a balance yet). Net worth doesn't count these: they aren't bank accounts.",
      "- Demo Credit Card ····0003: $2,410.50 at 22.99% (from your bank), $35.00 a month. Your bank shows it as overdue",
      "- Affirm plan: balance and rate not known yet, $89.50 a month",
      "- Demo Car Loan ····0006: $18,020.00 at 6.90% fixed (from your bank), $494.10 a month, paid off by Oct 1, 2029",
      "I don't have a rate for Affirm plan. Add it on the loans page and I'll count it.",
    ]);
    expect(reply.actions).toEqual([
      { id: "open", label: "See every debt", kind: "link", href: "/loans" },
    ]);
  });

  it("says so when there are no debts", () => {
    expect(debtsReply(book([], [])).body).toMatch(/^I don't see any loans/);
  });
});

describe("one debt", () => {
  it("gives a loan's balance, rate, payment and payoff date with their sources", () => {
    expect(debtDetailReply("car", book()).body.split("\n")).toEqual([
      "Your Demo Car Loan ····0006: $18,020.00 left at 6.90% fixed (from your bank).",
      "You pay $494.10 a month, next on Nov 1.",
      "It's paid off by Oct 1, 2029 (from your bank).",
    ]);
  });

  it("says a card has no end date, and when it's overdue", () => {
    const body = debtDetailReply("credit card", book()).body;
    expect(body).toContain("A card has no end date");
    expect(body).toContain("Your bank shows it as overdue: $35.00 past due.");
  });

  it("asks for what isn't known", () => {
    expect(debtDetailReply("affirm", book()).body).toContain(
      "I don't know what's left on it or its rate yet.",
    );
  });

  it("lists the debts when it can't find the one asked about", () => {
    expect(debtDetailReply("boat", book()).body).toBe(
      'I can\'t find "boat" among your debts. You have: Demo Credit Card ····0003, Affirm plan, Demo Car Loan ····0006.',
    );
  });
});
