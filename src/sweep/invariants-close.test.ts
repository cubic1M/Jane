import { describe, expect, it } from "vitest";
import { sameFigures } from "./invariants";
import { DATED } from "./reasons";

// Class 4 for last month's close (debug 2, sweep 5, upload S5, 11-18): "Net worth at the close:
// $642.18" was the balance on the day the close was taken, weeks later, while the chart had Oct 31
// at $915.16 (#2063). The sweep now reads the close as it's taken each day and holds its net worth
// to the chart's point on the month's last day.

const chart = (points: [date: string, cents: number][]) => ({
  "netWorth.length": points.length,
  ...Object.fromEntries(
    points.flatMap(([date, cents], i) => [
      [`netWorth.${i}.date`, date],
      [`netWorth.${i}.cents`, cents],
    ]),
  ),
});

describe("the close's net worth", () => {
  it("fails a close that says another day's net worth than the month's last", () => {
    const flat = {
      ...chart([
        ["2026-10-30", 90_000],
        ["2026-10-31", 91_516],
        ["2026-11-18", 64_218],
      ]),
      "home.hero.netWorth.cents": 64_218,
      "close.month": "2026-10",
      "close.netWorthCents": 64_218,
    };
    expect(sameFigures(flat)).toEqual([
      `close.netWorthCents: "$642.18", net worth on the chart on 2026-10-31 is 915.16`,
    ]);
  });

  it("passes the month's last day, a debt, and a chart that starts after it", () => {
    const owes = {
      ...chart([
        ["2026-10-31", -2_729_300],
        ["2026-11-18", -2_700_000],
      ]),
      "home.hero.netWorth.cents": -2_700_000,
      "close.month": "2026-10",
      "close.netWorthCents": -2_729_300,
    };
    expect(sameFigures(owes)).toEqual([]);
    const late = {
      ...chart([["2026-11-18", 64_218]]),
      "home.hero.netWorth.cents": 64_218,
      "close.month": "2026-10",
      "close.netWorthCents": 1,
    };
    expect(sameFigures(late)).toEqual([]);
  });

  it("passes no close figure (no balance known)", () => {
    const flat = {
      ...chart([["2026-10-31", 91_516]]),
      "close.month": "2026-10",
      "close.netWorthCents": null,
    };
    expect(sameFigures(flat)).toEqual([]);
  });

  it("moves only with a new month in the calendar sweep", () => {
    const month = DATED.find((r) => r.name === "a new month")!;
    expect(month.paths.test("close.month")).toBe(true);
    expect(month.paths.test("close.netWorthCents")).toBe(true);
  });
});
