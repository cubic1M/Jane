import { describe, expect, it } from "vitest";
import { payoffPlan } from "./debt";
import { breakEvenMonths, escrowChange, extraPrincipal, percent } from "./mortgage";

describe("refinance break-even", () => {
  it("is the closing costs over the monthly saving, rounded up", () => {
    expect(breakEvenMonths(781_000, 25_000)).toBe(32);
    expect(breakEvenMonths(780_000, 26_000)).toBe(30);
    expect(breakEvenMonths(0, 10_000)).toBe(0);
  });

  it("never pays back without a monthly saving", () => {
    expect(breakEvenMonths(500_000, 0)).toBeNull();
    expect(breakEvenMonths(500_000, -1_000)).toBeNull();
  });
});

describe("percentages", () => {
  // PMI itself is ./home-equity.ts's: one rule, against the home's original value.
  it("rounds a share to a tenth of a percent", () => {
    expect(percent(0.6942)).toBe("69.4%");
  });
});

describe("extra principal", () => {
  it("saves months and interest against the payment now, with the planner's math", () => {
    const result = extraPrincipal(31_240_000, 399, 219_831, [25_000])!;
    const base = payoffPlan(
      [{ id: "m", name: "m", balanceCents: 31_240_000, aprBps: 399, minimumCents: 219_831 }],
      219_831,
      "avalanche",
    );
    const more = payoffPlan(
      [{ id: "m", name: "m", balanceCents: 31_240_000, aprBps: 399, minimumCents: 244_831 }],
      244_831,
      "avalanche",
    );
    expect(result.baseMonths).toBe(base.ok ? base.months : -1);
    expect(result.scenarios[0]).toEqual({
      extraCents: 25_000,
      monthsSaved: (base.ok ? base.months : 0) - (more.ok ? more.months : 0),
      interestSavedCents:
        (base.ok ? base.totalInterestCents : 0) - (more.ok ? more.totalInterestCents : 0),
    });
    expect(result.scenarios[0].monthsSaved).toBeGreaterThan(0);
  });
});

describe("escrow changes", () => {
  const pay = (date: string, cents: number) => ({ date, cents });
  it("spots the latest payment moving against the ones before it", () => {
    expect(
      escrowChange([
        pay("2026-07-01", 214_154),
        pay("2026-08-01", 214_154),
        pay("2026-09-01", 214_154),
        pay("2026-10-01", 219_831),
      ]),
    ).toEqual({ fromCents: 214_154, toCents: 219_831, changeCents: 5_677, on: "2026-10-01" });
  });

  it("ignores pennies and a single payment", () => {
    expect(escrowChange([pay("2026-09-01", 214_154), pay("2026-10-01", 214_200)])).toBeNull();
    expect(escrowChange([pay("2026-10-01", 214_154)])).toBeNull();
  });
});
