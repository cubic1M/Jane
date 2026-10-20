import { describe, expect, it } from "vitest";
import { freePayoff, installments, newPlanStrain, notInForecast, type PlanSchedule } from "./bnpl";

const klarna: PlanSchedule = {
  key: "bnpl:klarna:6225",
  name: "Klarna Pay in 4",
  paymentCents: 6_225,
  every: "two_weeks",
  nextDue: "2026-10-22",
  balanceCents: 12_450,
};
const affirm: PlanSchedule = {
  key: "bnpl:affirm:8950",
  name: "Affirm plan",
  paymentCents: 8_950,
  every: "month",
  nextDue: "2026-10-25",
  balanceCents: null,
};

describe("installments from the plans' own schedules", () => {
  it("lists a Pay in 4 plan's remaining payments two weeks apart, and a monthly plan's each month", () => {
    const list = installments([klarna, affirm], "2026-10-19", "2026-11-30");
    expect(list.map((i) => `${i.date} ${i.name} ${i.cents}`)).toEqual([
      "2026-10-22 Klarna Pay in 4 6225",
      "2026-10-25 Affirm plan 8950",
      "2026-11-05 Klarna Pay in 4 6225",
      "2026-11-25 Affirm plan 8950",
    ]);
  });
  it("stops at the window and ignores plans with no schedule", () => {
    expect(installments([klarna], "2026-10-19", "2026-10-30")).toHaveLength(1);
    expect(installments([{ ...klarna, nextDue: null }], "2026-10-19", "2026-11-30")).toEqual([]);
  });
});

describe("what the forecast already counts", () => {
  it("drops installments that match a forecast bill by amount and date, once each", () => {
    const list = installments([klarna, affirm], "2026-10-19", "2026-11-30");
    const missing = notInForecast(list, [
      { date: "2026-10-26", amountCents: 8_950 },
      { date: "2026-11-05", amountCents: 6_225 },
    ]);
    expect(missing.map((i) => i.date)).toEqual(["2026-10-22", "2026-11-25"]);
  });
});

describe("a new plan against the checking forecast", () => {
  const days = Array.from({ length: 31 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 9, 19 + i)).toISOString().slice(0, 10),
    balanceCents: i < 10 ? 60_000 : 160_000,
  }));
  it("warns when its installments take checking under the cushion", () => {
    const s = newPlanStrain(days, {
      totalCents: 56_000,
      installments: 4,
      everyDays: 14,
      firstDate: "2026-10-19",
    })!;
    expect(s.installments.map((i) => i.date)).toEqual([
      "2026-10-19",
      "2026-11-02",
      "2026-11-16",
      "2026-11-30",
    ]);
    expect(s.installments[0].cents).toBe(14_000);
    expect(s.lowestWith.balanceCents).toBe(46_000);
    expect(s.strained).toBe(false);
    const big = newPlanStrain(days, {
      totalCents: 240_000,
      installments: 4,
      everyDays: 14,
      firstDate: "2026-10-19",
    })!;
    expect(big.strained).toBe(true);
    expect(big.shortCents).toBeGreaterThan(0);
    expect(big.lowestWithout.balanceCents).toBe(60_000);
  });
  it("says nothing without a forecast", () => {
    expect(
      newPlanStrain([], {
        totalCents: 100,
        installments: 4,
        everyDays: 14,
        firstDate: "2026-10-19",
      }),
    ).toBeNull();
  });
});

describe("paying off early", () => {
  it("is free only for a Pay in 4 plan with a known balance and no interest", () => {
    expect(freePayoff({ every: "two_weeks", balanceCents: 12_450, aprBps: 0 })).toBe(true);
    expect(freePayoff({ every: "two_weeks", balanceCents: 12_450, aprBps: null })).toBe(true);
    expect(freePayoff({ every: "two_weeks", balanceCents: 12_450, aprBps: 1_500 })).toBe(false);
    expect(freePayoff({ every: "month", balanceCents: 50_000, aprBps: 0 })).toBe(false);
    expect(freePayoff({ every: "two_weeks", balanceCents: null, aprBps: 0 })).toBe(false);
  });
});
