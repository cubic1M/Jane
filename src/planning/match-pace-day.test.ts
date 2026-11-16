import { describe, expect, it } from "vitest";
import { matchPaceGap, yearShare } from "./retirement-accounts";

// Gate C's calendar sweep (src/sweep/), 11-15: the 401(k) match pace read the year so far by UTC's
// month and day, so the suggestion's worth changed between 3pm and 7pm in Los Angeles, and grew a
// little every day for an account whose data had stopped. The year so far is the person's own and
// ends at the newest day the account's data covers.

const PLAN = { payCents: 8_160_000, matchRate: 0.5, matchUpTo: 0.06 };

describe("the year so far, for the match pace", () => {
  it("counts the person's days, a leap year's 366 included", () => {
    expect(yearShare("2026-12-31", null)).toBe(1);
    expect(yearShare("2026-01-01", null)).toBeCloseTo(1 / 365, 12);
    expect(yearShare("2028-02-29", null)).toBeCloseTo(60 / 366, 12);
  });

  it("ends at the data's newest day when that's earlier this year, and never past today", () => {
    expect(yearShare("2026-11-15", "2026-10-31")).toBe(yearShare("2026-10-31", null));
    expect(yearShare("2026-11-15", "2026-11-20")).toBe(yearShare("2026-11-15", null));
    // Last year's data says nothing about this year's pace.
    expect(yearShare("2027-01-10", "2026-12-31")).toBe(yearShare("2027-01-10", null));
  });

  it("gives the same pace on every day an account's data hasn't moved", () => {
    const at = (today: string) =>
      matchPaceGap(PLAN, 270_000, { today, through: "2026-10-31" }).missedCents;
    expect(at("2026-11-01")).toBe(at("2026-11-29"));
    // 4% of pay for ten months is 4% of pay at this pace.
    expect(
      matchPaceGap(PLAN, 272_000, { today: "2026-10-31", through: null }).employeeRate,
    ).toBeCloseTo(0.04, 3);
  });
});
