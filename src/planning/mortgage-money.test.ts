import { describe, expect, it } from "vitest";
import { RECAST_FEE_CENTS } from "@/config/mortgage-money";
import { breakEvenMonth, compareMortgageMoney, run } from "./mortgage-money";
import { levelPaymentCents } from "./refinance";

// Spec step 246: recast, refinance or pay extra, against investing it.

const loan = { balanceCents: 30_000_000, aprBps: 399, monthsLeft: 300, today: "2026-10-18" };
const base = { ...loan, lumpCents: 0, extraMonthlyCents: 0, refi: null };

describe("run", () => {
  it("pays a level-payment loan off in its months", () => {
    const pay = levelPaymentCents(loan.balanceCents, loan.aprBps, loan.monthsLeft);
    const r = run(loan.balanceCents, loan.aprBps, pay);
    expect(r.months).toBe(300);
    expect(r.cumulative).toHaveLength(301);
    expect(r.interestCents).toBeGreaterThan(10_000_000);
  });
  it("is quicker with extra, and refuses a payment that doesn't cover the interest", () => {
    const pay = levelPaymentCents(loan.balanceCents, loan.aprBps, loan.monthsLeft);
    expect(run(loan.balanceCents, loan.aprBps, pay, 50_000).months).toBeLessThan(300);
    expect(run(loan.balanceCents, loan.aprBps, 1_000).months).toBe(0);
  });
});

describe("compareMortgageMoney with a lump sum", () => {
  const m = compareMortgageMoney({ ...base, lumpCents: 5_000_000 });
  const [extra, recast, refi] = m.options;
  it("keeps the payment and ends sooner when paid as extra principal", () => {
    expect(extra.kind).toBe("extra");
    expect(extra.paymentCents).toBe(m.baseline.paymentCents);
    expect(extra.monthsToPayoff).toBeLessThan(m.baseline.monthsToPayoff);
    expect(extra.feeCents).toBe(0);
    expect(extra.interestSavedCents).toBeGreaterThan(0);
  });
  it("lowers the payment and keeps the end date on a recast, with its fee counted", () => {
    expect(recast.available).toBe(true);
    expect(recast.paymentCents).toBeLessThan(m.baseline.paymentCents);
    expect(recast.monthsToPayoff).toBe(m.baseline.monthsToPayoff);
    expect(recast.feeCents).toBe(RECAST_FEE_CENTS);
    // The same interest as extra principal over the same end date, less sooner, less the fee.
    expect(recast.interestSavedCents).toBeGreaterThan(0);
    expect(recast.interestSavedCents).toBeLessThan(extra.interestSavedCents);
    expect(recast.totalInterestCents).toBe(
      m.baseline.totalInterestCents - recast.interestSavedCents,
    );
  });
  it("dates when the recast's fee is paid back", () => {
    expect(recast.breakEvenMonths).toBeGreaterThan(0);
    expect(recast.breakEvenMonths!).toBeLessThan(24);
    expect(recast.breakEvenOn! > "2026-10-18").toBe(true);
    expect(extra.breakEvenMonths).toBeNull();
  });
  it("has no refinance without an offer under the rate", () => {
    expect(refi.available).toBe(false);
    expect(refi.why).toContain("No refinance offer");
  });
  it("shows both sides of paying down against investing", () => {
    expect(m.invest.putCents).toBe(5_000_000);
    expect(m.invest.lowGainCents).toBeLessThan(m.invest.highGainCents);
    // 3.99% is under the low investment return: investing could beat paying down.
    expect(m.verdict).toBe("invest");
    expect(m.guaranteedReturnPercent).toBe(4);
  });
});

describe("refinance", () => {
  it("counts its fee, and pays back by the month cumulative interest passes it", () => {
    const m = compareMortgageMoney({
      ...base,
      aprBps: 650,
      lumpCents: 0,
      extraMonthlyCents: 0,
      refi: { lender: "Cheaper Bank", aprBps: 500, feeCents: 400_000 },
    });
    const refi = m.options[2];
    expect(refi.available).toBe(true);
    expect(refi.label).toBe("Refinance with Cheaper Bank");
    expect(refi.paymentCents).toBeLessThan(m.baseline.paymentCents);
    expect(refi.interestSavedCents).toBeGreaterThan(0);
    expect(refi.breakEvenMonths).toBeGreaterThan(1);
    expect(m.verdict).toBe("close");
    expect(compareMortgageMoney({ ...base, aprBps: 800 }).verdict).toBe("pay_down");
  });
  it("is not an option at a higher rate", () => {
    const m = compareMortgageMoney({
      ...base,
      lumpCents: 2_000_000,
      refi: { lender: "Pricey", aprBps: 700, feeCents: 100_000 },
    });
    expect(m.options[2]).toMatchObject({ available: false, why: "No offer is under your rate." });
  });
});

describe("a recast", () => {
  it("needs a big enough lump sum, and a loan left to recast", () => {
    expect(compareMortgageMoney({ ...base, lumpCents: 500_000 }).options[1].why).toBe(
      "Most servicers need a bigger lump sum to recast.",
    );
    expect(compareMortgageMoney({ ...base, lumpCents: 0 }).options[1].why).toBe(
      "A recast needs a lump sum.",
    );
    expect(compareMortgageMoney({ ...base, lumpCents: 40_000_000 }).options[1].why).toBe(
      "That pays the loan off.",
    );
  });
});

describe("extra monthly money", () => {
  it("shortens the loan and invests monthly for the other side", () => {
    const m = compareMortgageMoney({ ...base, extraMonthlyCents: 50_000 });
    expect(m.options[0].monthsToPayoff).toBeLessThan(m.baseline.monthsToPayoff);
    expect(m.invest.putCents).toBe(50_000 * 25 * 12);
    expect(m.invest.highGainCents).toBeGreaterThan(m.invest.lowGainCents);
  });
});

describe("breakEvenMonth", () => {
  it("is null when an option never saves its fee", () => {
    const pay = levelPaymentCents(1_000_000, 400, 60);
    const same = run(1_000_000, 400, pay);
    expect(breakEvenMonth(same, same, 50_000)).toBeNull();
  });
});
