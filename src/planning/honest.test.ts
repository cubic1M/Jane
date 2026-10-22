import { describe, expect, it } from "vitest";
import { annualized, honestPeriod, type HonestInput } from "./honest";

// Spec step 233: how the money really did, and why it differs from the benchmark.

const BASE: HonestInput = {
  years: 3,
  twr: 0.3,
  mwr: 0.27,
  benchmark: 0.34,
  ownFeeBps: 60,
  benchFeeBps: 5,
  ownCashShare: 0.1,
  benchCashShare: 0.05,
  taxDragBps: 20,
};

describe("honestPeriod", () => {
  it("takes fees and taxes off the investments' return, and the benchmark's own fees off its", () => {
    const p = honestPeriod(BASE);
    expect(p.beforeFees).toBe(0.3);
    expect(p.afterFees).toBeCloseTo(0.3 - 0.006 * 3);
    expect(p.afterTaxes).toBeCloseTo(0.3 - 0.018 - 0.006);
    expect(p.benchmark).toBeCloseTo(0.34 - 0.0005 * 3);
    expect(p.gap).toBeCloseTo(p.afterTaxes - p.benchmark);
    expect(p.moneyWeighted).toBe(0.27);
  });

  it("explains the gap: the reasons add up to it exactly", () => {
    const p = honestPeriod(BASE);
    const sum = p.reasons.reduce((s, r) => s + r.points, 0);
    expect(sum).toBeCloseTo(p.gap, 12);
    const by = Object.fromEntries(p.reasons.map((r) => [r.key, r.points]));
    // Fees: (60 − 5) bps × 3 years = 1.65 points. Taxes: 20 bps × 3 = 0.6 points.
    expect(by.fees).toBeCloseTo(-0.0165);
    expect(by.taxes).toBeCloseTo(-0.006);
    // Cash: 5 points more in cash than the benchmark, on a 34% return.
    expect(by.cash).toBeCloseTo(-0.05 * 0.34);
    // Timing: money-weighted less time-weighted.
    expect(by.timing).toBeCloseTo(-0.03);
  });

  it("holds the identity for any inputs, with no timing reason without a money-weighted return", () => {
    for (let n = 1; n <= 30; n += 1) {
      const r = (k: number) => ((n * 37 + k * 101) % 100) / 100;
      const p = honestPeriod({
        years: 1 + (n % 5),
        twr: r(1) - 0.2,
        mwr: n % 3 === 0 ? null : r(2) - 0.2,
        benchmark: r(3) - 0.2,
        ownFeeBps: r(4) * 150,
        benchFeeBps: r(5) * 20,
        ownCashShare: r(6) * 0.3,
        benchCashShare: r(7) * 0.1,
        taxDragBps: r(8) * 60,
      });
      expect(p.reasons.reduce((s, x) => s + x.points, 0)).toBeCloseTo(p.gap, 10);
      if (n % 3 === 0) expect(p.reasons.find((x) => x.key === "timing")!.points).toBe(0);
    }
  });

  it("annualizes a cumulative return", () => {
    expect(annualized(0.3, 3)).toBeCloseTo(1.3 ** (1 / 3) - 1);
    expect(annualized(0.3, 0)).toBe(0.3);
  });
});
