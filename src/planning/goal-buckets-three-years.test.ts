import { describe, expect, it } from "vitest";
import { glideMix, goalBuckets, yearsUntil } from "./goal-buckets";

// CodeRabbit sweep 1c, cfg-02 #2: a goal due exactly three calendar years out is near-term
// whether or not a leap day falls in the span.

const goal = (targetDate: string) => [{ id: "g", name: "House", targetDate, monthlyCents: 10_000 }];

describe("three calendar years is near-term", () => {
  it("is 3 years either side of a leap day", () => {
    expect(yearsUntil("2026-03-01", "2029-03-01")).toBe(3); // no leap day
    expect(yearsUntil("2027-03-01", "2030-03-01")).toBe(3);
    expect(yearsUntil("2027-01-15", "2030-01-15")).toBe(3); // spans Feb 29, 2028
    expect(yearsUntil("2028-02-29", "2031-02-28")).toBeCloseTo(3, 1);
  });

  it("puts both goals in cash", () => {
    for (const [from, to] of [
      ["2026-03-01", "2029-03-01"],
      ["2027-01-15", "2030-01-15"],
    ]) {
      const [b] = goalBuckets(goal(to), from, 3);
      expect(b.nearTerm, `${from} to ${to}`).toBe(true);
      expect(b.mix.cash).toBe(1);
    }
  });

  it("glideMix agrees at the boundary, and 3 years and a bit is the 30% row", () => {
    expect(glideMix(3, 3).cash).toBe(1);
    expect(glideMix(3.01, 3).us_stocks + glideMix(3.01, 3).intl_stocks).toBeGreaterThan(0);
    const [far] = goalBuckets(goal("2030-02-01"), "2027-01-15", 3);
    expect(far.nearTerm).toBe(false);
  });
});
