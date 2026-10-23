import { describe, expect, it } from "vitest";
import type { Debt } from "@/insights/debts";
import { dmpSketch, overTheLine, paymentShare, troubleReason } from "./debt-trouble";

// Spec step 229: the share of income going to debt, and a sketch of a debt management plan.

const card = (over: Partial<Debt>): Debt =>
  ({
    key: "account:c1",
    accountId: "c1",
    name: "Card",
    kind: "card",
    balanceCents: 500_000,
    aprBps: 2499,
    paymentCents: 20_000,
    ...over,
  }) as Debt;

describe("paymentShare", () => {
  it("is payments over income, and unknown without income", () => {
    expect(paymentShare(300_000, 600_000)).toBe(0.5);
    expect(paymentShare(300_000, null)).toBeNull();
    expect(paymentShare(300_000, 0)).toBeNull();
  });
  it("crosses the line at the configured share", () => {
    expect(overTheLine(0.4)).toBe(true);
    expect(overTheLine(0.39)).toBe(false);
    expect(overTheLine(null)).toBe(false);
  });
});

describe("dmpSketch", () => {
  it("clears the cards sooner and cheaper at the assumed rate, from the person's own cards", () => {
    const s = dmpSketch([
      card({}),
      card({ key: "account:c2", balanceCents: 200_000, paymentCents: 10_000 }),
    ])!;
    expect(s.cardBalanceCents).toBe(700_000);
    expect(s.cardPaymentCents).toBe(30_000);
    expect(s.monthsAssumed).toBeLessThan(s.monthsNow!);
    expect(s.interestCutCents).toBeGreaterThan(0);
    expect(s.interestNowCents! - s.interestAssumedCents).toBe(s.interestCutCents);
  });
  it("never raises a rate that is already under the assumed one", () => {
    const s = dmpSketch([card({ aprBps: 500 })])!;
    expect(s.interestCutCents).toBe(0);
    expect(s.monthsAssumed).toBe(s.monthsNow);
  });
  it("leaves out what isn't a card with a balance, rate and payment", () => {
    expect(
      dmpSketch([card({ kind: "auto" }), card({ aprBps: null }), card({ balanceCents: 0 })]),
    ).toBeNull();
  });
  it("has no plan when the payment doesn't cover the interest at today's rate", () => {
    const s = dmpSketch([card({ paymentCents: 5_000 })])!;
    expect(s.monthsNow).toBeNull();
    expect(s.interestCutCents).toBe(0);
    expect(s.monthsAssumed).toBeGreaterThan(0);
  });
});

// One judgement for "too much debt" (docs/feature-audit.md, cluster 14): the profile (and so the
// hardship suggestion) and /loans/help both ask troubleReason.
describe("troubleReason", () => {
  const base = {
    monthlyIncomeCents: 500_000,
    cardDebtCents: 0,
    paydayRepayments: 0,
    paydayRepaidCents: 0,
    debtPaymentsCents: 100_000,
    cashCents: 1_000_000,
  };
  it("is a payday-loan cycle, then card debt worth months of income, then payments over the line", () => {
    expect(troubleReason(base)).toBeNull();
    // 5% of a year's income repaid in cash advances.
    expect(troubleReason({ ...base, paydayRepayments: 4, paydayRepaidCents: 300_000 })).toBe(
      "payday_cycle",
    );
    expect(troubleReason({ ...base, cardDebtCents: 1_500_000 })).toBe("card_debt");
    expect(troubleReason({ ...base, debtPaymentsCents: 250_000, cashCents: 100_000 })).toBe(
      "payments",
    );
    // Over 40%, but the cash carries three months of the payments.
    expect(troubleReason({ ...base, debtPaymentsCents: 250_000 })).toBeNull();
  });
  it("is nothing without an income to compare with", () => {
    expect(troubleReason({ ...base, monthlyIncomeCents: 0, cardDebtCents: 9_999_999 })).toBeNull();
  });
});
