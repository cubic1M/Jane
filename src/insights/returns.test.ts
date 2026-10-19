import { describe, expect, it } from "vitest";
import { blendedReturn, formatReturn, moneyWeightedReturn, timeWeightedReturn } from "./returns";

// Spec step 156: returns that count money paid in properly, against worked examples.

describe("timeWeightedReturn", () => {
  it("measures the investments, not the deposits", () => {
    // $100 grows to $110 (+10%); then $100 goes in and the $210 grows to $220 (+4.76%).
    const values = [
      { day: "2026-01-01", valueCents: 10_000 },
      { day: "2026-02-01", valueCents: 11_000 },
      { day: "2026-03-01", valueCents: 22_000 },
    ];
    // Paid in on Feb 1, after that day's valuation.
    const r = timeWeightedReturn(values, [{ day: "2026-02-01", amountCents: 10_000 }]);
    expect(r).toBeCloseTo(1.1 * (22_000 / 21_000) - 1, 10);
    expect(r).toBeCloseTo(0.152381, 5);
    // The same values without the deposit would count it as a gain.
    expect(timeWeightedReturn(values, [])).toBeCloseTo(1.2, 10);
  });

  it("subtracts money taken out, and needs two valuations", () => {
    const r = timeWeightedReturn(
      [
        { day: "2026-01-01", valueCents: 10_000 },
        { day: "2026-02-01", valueCents: 6_000 },
      ],
      [{ day: "2026-01-01", amountCents: -5_000 }],
    );
    expect(r).toBeCloseTo(6_000 / 5_000 - 1, 10);
    expect(timeWeightedReturn([{ day: "2026-01-01", valueCents: 1 }], [])).toBeNull();
  });
});

describe("moneyWeightedReturn", () => {
  it("is the yearly rate with no money in or out", () => {
    const r = moneyWeightedReturn({ day: "2025-01-01", valueCents: 100_000 }, [], {
      day: "2026-01-01",
      valueCents: 110_000,
    });
    expect(r?.yearly).toBeCloseTo(0.1, 6);
    expect(r?.period).toBeCloseTo(0.1, 6);
  });

  it("weights money by how long it was invested", () => {
    // $1,000 for a year and $1,000 more after 182 days grow to $2,200: about 13.46% a year,
    // more than the 10% the money looks to have made, because half was in for half the time.
    const r = moneyWeightedReturn(
      { day: "2025-01-01", valueCents: 100_000 },
      [{ day: "2025-07-02", amountCents: 100_000 }],
      { day: "2026-01-01", valueCents: 220_000 },
    );
    expect(r?.yearly).toBeCloseTo(0.134627, 5);
  });

  it("gives the period's rate for short periods, and nothing without one", () => {
    const r = moneyWeightedReturn({ day: "2026-01-01", valueCents: 100_000 }, [], {
      day: "2026-01-31",
      valueCents: 101_000,
    });
    expect(r?.period).toBeCloseTo(0.01, 6);
    expect(
      moneyWeightedReturn({ day: "2026-01-01", valueCents: 1 }, [], {
        day: "2026-01-01",
        valueCents: 2,
      }),
    ).toBeNull();
  });
});

describe("blendedReturn", () => {
  it("weights each part's daily moves by its share", () => {
    const up = [
      { day: "d1", valueCents: 100 },
      { day: "d2", valueCents: 110 },
    ];
    const flat = [
      { day: "d1", valueCents: 100 },
      { day: "d2", valueCents: 100 },
    ];
    expect(
      blendedReturn([
        { weight: 0.6, prices: up },
        { weight: 0.4, prices: flat },
      ]),
    ).toBeCloseTo(0.06, 10);
  });

  it("formats returns with a sign", () => {
    expect(formatReturn(0.0423)).toBe("+4.2%");
    expect(formatReturn(-0.013)).toBe("−1.3%");
  });
});
