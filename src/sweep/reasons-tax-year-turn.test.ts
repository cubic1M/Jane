import { describe, expect, it } from "vitest";
import { unexplained } from "./diff";
import { DATED } from "./reasons";

// Gate C's full calendar sweep (11-20, debug 3) on main: on 2027-01-01 the snapshot's income moved
// in 10 frozen runs with no new data (the renter's income.yearCents 5,261,568 to 5,116,800 cents,
// mid-start's payOnly true to false). It's the tax year turning: Dec 31's year is 2026's own pay,
// Jan 1's is 2027's, with none in it yet, so its month as a year; the tax cards name the year
// ("2026 income near …", "2027 income near …"). So it may change on Jan 1 and on no other day.

const person = { linked: "2026-10-25", lastLine: "2026-10-24", accountsLast: [] };
const turn = (day: string) =>
  unexplained(
    day,
    [
      { path: "income.yearCents", before: 5_261_568, after: 5_116_800 },
      { path: "income.fromMonthCents", before: 5_116_800, after: 5_116_800 + 1 },
      { path: "income.payOnly", before: true, after: false },
      { path: "income.chatYearGross", before: "$52,615.68", after: "$51,168.00" },
    ],
    DATED,
    person,
  ).map((c) => c.path);

describe("the tax year's income at the year's turn", () => {
  it("may change on Jan 1: a new tax year", () => {
    expect(turn("2027-01-01")).toEqual([]);
  });

  it.each(["2026-12-30", "2026-12-31", "2027-01-02"])("may not change on %s", (day) => {
    expect(turn(day)).toEqual([
      "income.yearCents",
      "income.fromMonthCents",
      "income.payOnly",
      "income.chatYearGross",
    ]);
  });

  it("covers only the tax year's own income, not the month's", () => {
    expect(
      unexplained(
        "2027-01-01",
        [{ path: "income.monthlyCents", before: 328_000, after: 320_000 }],
        DATED,
        person,
      ).map((c) => c.path),
    ).toEqual(["income.monthlyCents"]);
  });
});
