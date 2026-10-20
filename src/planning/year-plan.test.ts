import { describe, expect, it } from "vitest";
import { addMonths, yearPlan, yearTotals, type YearInput } from "./year-plan";

const base: YearInput = {
  startMonth: "2026-10",
  currentMonth: "2026-10",
  marginCents: 200_000,
  wants: { saving: 80_000, debt: 50_000, investing: 40_000 },
  fixed: [
    { month: "2026-12", sector: "insurance", cents: 90_000 },
    { month: "2027-04", sector: "taxes", cents: 150_000 },
  ],
  past: [],
  actuals: {},
};

describe("yearPlan", () => {
  it("plans twelve months from the start", () => {
    const plan = yearPlan(base);
    expect(plan.map((m) => m.month)[0]).toBe("2026-10");
    expect(plan.map((m) => m.month)[11]).toBe("2027-09");
    expect(plan[0].targets).toMatchObject({ saving: 80_000, debt: 50_000, investing: 40_000 });
  });

  it("fits every month in the forecast's margin, trimming investing first, then saving", () => {
    const plan = yearPlan(base);
    for (const m of plan) {
      const sum = Object.values(m.targets).reduce((s, c) => s + c, 0);
      expect(sum, m.month).toBeLessThanOrEqual(base.marginCents);
    }
    // December carries the insurance renewal, so less is left to invest.
    const dec = plan.find((m) => m.month === "2026-12")!;
    expect(dec.targets.insurance).toBe(90_000);
    expect(dec.trimmed).toBe(true);
    expect(dec.targets.debt).toBe(50_000);
    expect(dec.targets.investing).toBeLessThan(40_000);
    // April's tax payment leaves nothing for investing and part of saving.
    const apr = plan.find((m) => m.month === "2027-04")!;
    expect(apr.targets.taxes).toBe(150_000);
    expect(apr.targets.investing).toBe(0);
    expect(apr.targets.saving).toBe(0);
  });

  it("the months add up to the year, sector by sector", () => {
    const plan = yearPlan(base);
    const totals = yearTotals(plan);
    expect(totals.insurance).toBe(90_000);
    expect(totals.taxes).toBe(150_000);
    expect(totals.debt).toBe(plan.reduce((s, m) => s + m.targets.debt, 0));
  });

  it("a missed month moves into the months ahead and never changes the past", () => {
    const first = yearPlan({ ...base, currentMonth: "2026-10" });
    // October passes with only half of saving done; it's now November.
    const second = yearPlan({
      ...base,
      currentMonth: "2026-11",
      past: [first[0]],
      actuals: { "2026-10": { saving: 40_000, debt: 50_000, investing: 40_000 } },
    });
    expect(second[0].targets).toEqual(first[0].targets);
    expect(second[0].actual?.saving).toBe(40_000);
    // The $400 saving missed is spread over the eleven months left, where there's room.
    const nov = second[1];
    expect(nov.targets.saving).toBe(80_000 + Math.round(40_000 / 11));
    const caught = second.slice(1).reduce((s, m) => s + m.targets.saving, 0);
    const wanted = first.slice(1).reduce((s, m) => s + m.targets.saving, 0);
    expect(caught).toBeGreaterThan(wanted);
    expect(caught - wanted).toBeLessThanOrEqual(40_000);
  });

  it("makes up nothing when the past month met its targets", () => {
    const first = yearPlan(base);
    const second = yearPlan({
      ...base,
      currentMonth: "2026-11",
      past: [first[0]],
      actuals: { "2026-10": { saving: 80_000, debt: 50_000, investing: 40_000 } },
    });
    expect(second.slice(1)).toEqual(first.slice(1));
  });

  it("adds months across a year end", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
  });
});
