import { describe, expect, it } from "vitest";
import { monthsToShow } from "./investing";

// Debug 2 (11-16): Month by month starts at the first month with a balance, and is only a list once
// two months have one; one month is the total already shown above it.

const m = (month: string, totalCents: number | null) => ({ month, totalCents });

describe("the months Investing lists", () => {
  it("starts at the first month with a balance", () => {
    const rows = [m("2026-09", null), m("2026-10", 800_000), m("2026-11", 831_546)];
    expect(monthsToShow(rows).map((r) => r.month)).toEqual(["2026-10", "2026-11"]);
  });

  it("is empty with one month known, or none", () => {
    expect(monthsToShow([m("2026-10", null), m("2026-11", 831_546)])).toEqual([]);
    expect(monthsToShow([m("2026-11", null)])).toEqual([]);
  });
});
