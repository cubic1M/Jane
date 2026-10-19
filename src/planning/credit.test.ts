import { describe, expect, it } from "vitest";
import { DEMO_CARD_LIMIT_CENTS, demoScore } from "@/lib/credit/demo";
import type { CreditReport, CreditRequest } from "@/lib/credit/partner";
import { creditBandOf, creditFactors, utilisation } from "./credit";

const request = (over: Partial<CreditRequest> = {}): CreditRequest => ({
  cardBalanceCents: 241_050,
  overdue: false,
  lateFeesLastYear: 1,
  hasInstallmentLoan: true,
  month: "2026-10",
  ...over,
});
const report: CreditReport = {
  score: 705,
  model: "Stand-in score, 300–850",
  range: { low: 300, high: 850 },
  cardLimitCents: 800_000,
  averageAgeMonths: 86,
  hardInquiries: 1,
  demo: true,
};

describe("card utilisation", () => {
  it("is the share of limits in use, with what to pay to get under 30% and 10%", () => {
    expect(utilisation(241_050, 800_000)).toEqual({
      share: 241_050 / 800_000,
      balanceCents: 241_050,
      limitCents: 800_000,
      toUnderHighCents: 1_050,
      toUnderGoodCents: 161_050,
    });
    expect(utilisation(50_000, 800_000)?.toUnderHighCents).toBe(0);
    expect(utilisation(1, 0)).toBeNull();
  });
});

describe("what's helping and hurting", () => {
  it("names each factor with why", () => {
    const factors = creditFactors(report, request());
    expect(factors.map((f) => [f.key, f.impact])).toEqual([
      ["payment_history", "hurting"],
      ["utilisation", "hurting"],
      ["credit_age", "helping"],
      ["inquiries", "neutral"],
      ["mix", "helping"],
    ]);
    expect(factors[1].detail).toBe("30% of your card limits in use ($2,410.50 of $8,000.00).");
    expect(
      creditFactors(report, request({ lateFeesLastYear: 0, cardBalanceCents: 40_000 }))[0].impact,
    ).toBe("helping");
    expect(creditFactors(report, request({ overdue: true }))[0].detail).toBe(
      "A loan shows as overdue.",
    );
  });

  it("bands the score for the lender stand-ins", () => {
    expect(creditBandOf(760)).toBe("excellent");
    expect(creditBandOf(705)).toBe("good");
    expect(creditBandOf(640)).toBe("fair");
  });
});

describe("the stand-in score", () => {
  it("moves with card use, late fees and an overdue loan", () => {
    expect(demoScore(request())).toBe(705);
    expect(demoScore(request({ cardBalanceCents: 40_000 }))).toBeGreaterThan(705);
    expect(demoScore(request({ overdue: true }))).toBe(645);
    expect(demoScore(request({ cardBalanceCents: DEMO_CARD_LIMIT_CENTS }))).toBeLessThan(705);
  });
});
