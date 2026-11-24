import { describe, expect, it } from "vitest";
import { yearPlan, type YearInput } from "./year-plan";

// CodeRabbit sweep 1b: a replan counted January's shortfall again after February made it up,
// because February's target already held its catch-up and only the unmet part of it was credited.
const input: YearInput = {
  startMonth: "2026-01",
  currentMonth: "2026-02",
  marginCents: 1_000_000,
  wants: { saving: 110_000, debt: 0, investing: 0 },
  fixed: [],
  past: [],
  actuals: { "2026-01": { saving: 0, debt: 0, investing: 0 } },
};

describe("the catch-up in a replan", () => {
  it("February's replan adds 10,000 to each of the 11 months left", () => {
    const feb = yearPlan(input);
    expect(feb[1].targets.saving).toBe(120_000);
  });
  it("after February met its catch-up, March's catch-up is still 10,000, not 11,000", () => {
    const feb = yearPlan(input);
    const march = yearPlan({
      ...input,
      currentMonth: "2026-03",
      past: feb.slice(0, 2),
      actuals: {
        "2026-01": { saving: 0, debt: 0, investing: 0 },
        "2026-02": { saving: 120_000, debt: 0, investing: 0 },
      },
    });
    expect(march[2].targets.saving).toBe(120_000);
  });
});
