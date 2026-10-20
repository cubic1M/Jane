import { describe, expect, it } from "vitest";
import { BUFFER_FLOOR_MONTHS } from "@/config/steady-pay";
import { simulateYear, steadyPlan } from "./steady-pay";

// Spec step 240, pure: the steady paycheck from uneven income, the buffer's floor and target.

const spending = 400_000;
const uneven = [
  900_000, 150_000, 0, 700_000, 1_200_000, 100_000, 650_000, 0, 800_000, 300_000, 950_000, 200_000,
];

describe("steadyPlan", () => {
  it("needs a few months of income first", () => {
    expect(
      steadyPlan({
        monthlyDepositsCents: [500_000, 600_000],
        setAsideRate: 0.25,
        bufferCents: 1_000_000,
        monthlySpendingCents: spending,
      }),
    ).toMatchObject({
      status: "not_enough_history",
      paycheckCents: 0,
    });
  });

  it("pays a share of the average income after tax set-aside, on target", () => {
    const average = uneven.reduce((s, c) => s + c, 0) / uneven.length;
    const plan = steadyPlan({
      monthlyDepositsCents: uneven,
      setAsideRate: 0.25,
      bufferCents: 3 * spending,
      monthlySpendingCents: spending,
    });
    expect(plan.usualCents).toBe(Math.round(average * 0.75 * 0.9));
    expect(plan.paycheckCents).toBe(plan.usualCents);
    expect(plan.adjust).toBe("steady");
    expect(plan.reason).toMatch(/on target/);
  });

  it("pays more with the buffer above target and less below, within a quarter", () => {
    const base = {
      monthlyDepositsCents: uneven,
      setAsideRate: 0.25,
      monthlySpendingCents: spending,
    };
    const usual = steadyPlan({ ...base, bufferCents: 3 * spending }).paycheckCents;
    const high = steadyPlan({ ...base, bufferCents: 8 * spending });
    const low = steadyPlan({ ...base, bufferCents: 2.4 * spending });
    expect(high.paycheckCents).toBeGreaterThan(usual);
    expect(high.paycheckCents).toBeLessThanOrEqual(Math.round(usual * 1.25));
    expect(low.paycheckCents).toBeLessThan(usual);
    expect(low.paycheckCents).toBeGreaterThanOrEqual(Math.round(usual * 0.75));
    expect(high.adjust).toBe("raised");
    expect(low.adjust).toBe("lowered");
  });

  it("never takes the buffer below its floor", () => {
    const base = {
      monthlyDepositsCents: uneven,
      setAsideRate: 0.25,
      monthlySpendingCents: spending,
    };
    const floor = BUFFER_FLOOR_MONTHS * spending;
    const near = steadyPlan({ ...base, bufferCents: floor + 50_000 });
    expect(near.paycheckCents).toBe(50_000);
    expect(near.reason).toMatch(/held to that/);
    const at = steadyPlan({ ...base, bufferCents: floor });
    expect(at).toMatchObject({ status: "no_floor_room", paycheckCents: 0 });
  });
});

describe("simulateYear", () => {
  it("keeps the buffer at or above its floor through a year of uneven deposits", () => {
    const floor = BUFFER_FLOOR_MONTHS * spending;
    for (const start of [floor, 2 * spending, 5 * spending]) {
      const year = simulateYear([...uneven, ...uneven], 0.25, start, spending);
      for (const m of year) expect(m.bufferCents).toBeGreaterThanOrEqual(floor);
    }
  });

  it("pays about the same each month despite deposits that swing from nothing to $12,000", () => {
    const year = simulateYear([...uneven, ...uneven], 0.25, 3 * spending, spending).slice(12);
    const pays = year.map((m) => m.paycheckCents);
    expect(Math.max(...pays) - Math.min(...pays)).toBeLessThan(0.5 * Math.max(...pays));
    expect(Math.min(...pays)).toBeGreaterThan(0);
  });

  it("holds a lean stretch without going under the floor", () => {
    const lean = [...uneven.slice(0, 6), 0, 0, 0, 0, 0, 0];
    const floor = BUFFER_FLOOR_MONTHS * spending;
    const year = simulateYear(lean, 0.25, 3 * spending, spending);
    expect(Math.min(...year.map((m) => m.bufferCents))).toBeGreaterThanOrEqual(floor);
  });
});
