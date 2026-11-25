import { describe, expect, it } from "vitest";
import { yearPlan, type YearInput } from "./year-plan";

// CodeRabbit sweep 1b (#2258): a passed month's own target was read off today's `wants`, so when
// the wants fell between replans, the month's shortfall fell with them.
const input: YearInput = {
  startMonth: "2026-01",
  currentMonth: "2026-01",
  marginCents: 1_000_000,
  wants: { saving: 110_000, debt: 0, investing: 0 },
  fixed: [],
  past: [],
  actuals: {},
};
const zero = { saving: 0, debt: 0, investing: 0 };

describe("a passed month's own target", () => {
  const january = yearPlan(input)[0]!;
  const later = (overrides: Partial<YearInput>) =>
    yearPlan({
      ...input,
      currentMonth: "2026-02",
      past: [january],
      actuals: { "2026-01": { ...zero, saving: 100_000 } },
      ...overrides,
    });

  it("is kept when the wants fall: January's 10,000 shortfall is still owed", () => {
    const lower = later({ wants: { ...zero, saving: 100_000 } });
    // 10,000 owed over the 11 months left, on top of the 100,000 a month
    expect(lower[1]!.targets.saving).toBe(100_000 + Math.round(10_000 / 11));
  });
  it("falls back to the current wants for a row saved before it was stored", () => {
    const { own: _own, ...old } = january;
    void _own;
    const lower = later({ past: [old], wants: { ...zero, saving: 100_000 } });
    expect(lower[1]!.targets.saving).toBe(100_000);
  });
});
