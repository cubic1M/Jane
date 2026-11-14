import { describe, expect, it } from "vitest";
import { yearCovered } from "./tax-income";

// Debugger 11-14: a student uploaded one statement (Sep 29 to Oct 24) and opened Taxes on Nov 14.
// "Federal: about $2,049 of tax for 2026": $4,441.80 of pay in the statement's 26 days was spread
// over the 46 days to today, a $35,000 year where the pay ran at about $62,000. The share of the
// year the data covers ends where the data does, once it ended a while ago.

const days = (n: number) => n / 365;

describe("the share of the year a statement covers", () => {
  it("ends where an old statement ends", () => {
    expect(yearCovered(2026, "2026-11-14", "2026-09-29", "2026-10-24")).toBeCloseTo(days(25), 6);
  });

  it("runs to today while the data is recent", () => {
    expect(yearCovered(2026, "2026-11-14", "2026-09-29", "2026-11-12")).toBeCloseTo(days(46), 6);
  });
});
