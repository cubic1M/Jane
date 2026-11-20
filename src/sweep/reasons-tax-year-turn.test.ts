import { describe, expect, it } from "vitest";
import { changes, type Flat, unexplained } from "./diff";
import { DATED } from "./reasons";

// Gate C's full calendar sweep (11-20, debug 3) on main: on 2027-01-01 the snapshot's income moved
// in 10 frozen runs with no new data (the renter's income.yearCents 5,261,568 to 5,116,800 cents,
// the chat's "$52,615.68" to "$51,168.00"; mid-start's payOnly true to false). Dec 31's year is
// 2026's own pay, 3,280,000 cents in 20 paychecks paced over the 9.72 months to Oct 23 and grossed
// up; Jan 1's is 2027's, which has no pay yet, so the same $3,280 month as a year (no bonus either
// side). The cards name the year. It may change on Jan 1 only, and only by exactly that.

const person = { linked: "2026-10-25", lastLine: "2026-10-24", accountsLast: [] };
const renterDec31: Flat = {
  "income.monthlyCents": 328_000,
  "income.yearCents": 5_261_568,
  "income.lastYearCents": 1_097_600,
  "income.fromMonthCents": 5_116_800,
  "income.payOnly": false,
  "income.chatYearGross": "$52,615.68",
};
const renterJan1: Flat = {
  ...renterDec31,
  "income.yearCents": 5_116_800,
  "income.lastYearCents": 5_261_568,
  "income.chatYearGross": "$51,168.00",
};
const midStartDec31: Flat = {
  "income.monthlyCents": 840_000,
  "income.yearCents": 13_104_000,
  "income.lastYearCents": 13_104_000,
  "income.fromMonthCents": 13_104_000,
  "income.payOnly": true,
  "income.chatYearGross": "$131,040.00",
};
const midStartJan1: Flat = { ...midStartDec31, "income.payOnly": false };

const left = (day: string, before: Flat, after: Flat) =>
  unexplained(day, changes(before, after), DATED, person, { before, after }).map((c) => c.path);

describe("the tax year turning", () => {
  it("explains Jan 1's income when it adds up from Dec 31's", () => {
    expect(left("2027-01-01", renterDec31, renterJan1)).toEqual([]);
    expect(left("2027-01-01", midStartDec31, midStartJan1)).toEqual([]);
  });

  it("still fails a made-up $1 drift in the year's income across Jan 1", () => {
    const drift = { ...renterJan1, "income.yearCents": 5_116_900 };
    expect(left("2027-01-01", renterDec31, drift)).toContain("income.yearCents");
    const lastDrift = { ...renterJan1, "income.lastYearCents": 5_261_668 };
    expect(left("2027-01-01", renterDec31, lastDrift)).toContain("income.lastYearCents");
    const chatDrift = { ...renterJan1, "income.chatYearGross": "$51,169.00" };
    expect(left("2027-01-01", renterDec31, chatDrift)).toContain("income.chatYearGross");
  });

  it("fails a bonus left in the new year, or a month that moved with it", () => {
    const bonus = {
      ...renterJan1,
      "income.yearCents": 5_246_800,
      "income.fromMonthCents": 5_246_800,
      "income.chatYearGross": "$52,468.00",
    };
    expect(left("2027-01-01", renterDec31, bonus)).toContain("income.yearCents");
    const month = { ...renterJan1, "income.monthlyCents": 330_000 };
    expect(left("2027-01-01", renterDec31, month)).toEqual(
      expect.arrayContaining(["income.monthlyCents", "income.yearCents"]),
    );
  });

  it.each(["2026-12-30", "2026-12-31", "2027-01-02", "2027-02-01"])(
    "fails the same fields moving the same way on %s",
    (day) => {
      expect(left(day, renterDec31, renterJan1)).toEqual([
        "income.chatYearGross",
        "income.lastYearCents",
        "income.yearCents",
      ]);
      expect(left(day, midStartDec31, midStartJan1)).toEqual(["income.payOnly"]);
    },
  );

  it("explains nothing without the two snapshots to add up", () => {
    expect(
      unexplained("2027-01-01", changes(renterDec31, renterJan1), DATED, person).map((c) => c.path),
    ).toEqual(["income.chatYearGross", "income.lastYearCents", "income.yearCents"]);
  });
});
