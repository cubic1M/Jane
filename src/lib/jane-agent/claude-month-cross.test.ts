import { describe, expect, it } from "vitest";
import { crossesMonthAlert } from "./claude-limits";

// Beta (11-12): the answer that takes Claude's month past a share the team hears about (half, 70%,
// all of it) tells them at once. Hundredths of a cent, against an $8.00 month.

describe("crossing a share of Claude's month", () => {
  const cap = 800;
  it("is the step that passes 50%, 70% or the cap", () => {
    expect(crossesMonthAlert(39_900, 40_000, cap)).toBe(true);
    expect(crossesMonthAlert(55_000, 56_100, cap)).toBe(true);
    expect(crossesMonthAlert(79_999, 80_000, cap)).toBe(true);
    // One answer past two of them at once still says so once.
    expect(crossesMonthAlert(30_000, 90_000, cap)).toBe(true);
  });

  it("isn't a step that stays between them", () => {
    expect(crossesMonthAlert(0, 39_999, cap)).toBe(false);
    expect(crossesMonthAlert(40_000, 55_999, cap)).toBe(false);
    expect(crossesMonthAlert(80_000, 90_000, cap)).toBe(false);
  });
});
