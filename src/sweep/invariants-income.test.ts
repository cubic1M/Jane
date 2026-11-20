import { describe, expect, it } from "vitest";
import { sameFigures } from "./invariants";

// Class 4 for income (debug 3, upload S5, 11-19): a month of income is the profile's in the chat and
// on the cards, the tax cards' "income near $X" is one year, and when that year is only pay it's the
// profile's month of pay as a year.

const flat = (near: string, year: number, fromMonth: number, payOnly = true) => ({
  "income.monthlyCents": 134_333,
  "income.yearCents": year,
  "income.fromMonthCents": fromMonth,
  "income.payOnly": payOnly,
  "suggestions.taxes:savers_credit.short": `Income near ${near} is under its $39,500.00 limit; 2026 is its last year.`,
});

describe("income on the tax cards", () => {
  it("fails a card whose income isn't the year's", () => {
    expect(sameFigures(flat("$28,489.50", 2_095_595, 2_095_595))).toEqual([
      `suggestions.taxes:savers_credit.short: "$28,489.50", the year's income is 20955.95`,
    ]);
  });

  it("fails a year of pay that isn't the profile's month of it", () => {
    expect(sameFigures(flat("$28,489.50", 2_848_950, 2_095_595))).toEqual([
      `income.yearCents: "$28489.50", the profile's month of pay, as a year is 20955.95`,
    ]);
  });

  it("fails a chat answer or a card whose month isn't the profile's", () => {
    expect(
      sameFigures({
        ...flat("$20,955.95", 2_095_595, 2_095_595),
        "income.chatFigure": "$1,860.00",
        "suggestions.insurance:disability_insurance.short":
          "You earn about $1,826.25 a month, with no disability cover on file.",
      }),
    ).toEqual([
      `income.chatFigure: "$1,860.00", the profile's monthly income is 1343.33`,
      `suggestions.insurance:disability_insurance.short: "$1,826.25", the profile's monthly income is 1343.33`,
    ]);
  });

  it("passes the profile's month in the chat and on a card, and a chat that doesn't know yet", () => {
    const one = {
      ...flat("$20,955.95", 2_095_595, 2_095_595),
      "suggestions.insurance:disability_insurance.short":
        "You earn about $1,343.33 a month, with no disability cover on file.",
    };
    expect(sameFigures({ ...one, "income.chatFigure": "$1,343.33" })).toEqual([]);
    expect(sameFigures({ ...one, "income.chatFigure": "unknown" })).toEqual([]);
  });

  it("fails a month of pay that isn't the pay schedule's", () => {
    // Main's reading of upload S5: three $620 paychecks in a 30-day file, $1,826.25 a month.
    expect(
      sameFigures({
        ...flat("$27,971.77", 2_797_177, 2_797_177),
        "income.monthlyCents": 182_625,
        "income.scheduleMonthCents": 134_333,
      }),
    ).toEqual([`income.monthlyCents: "$1826.25", the pay schedule's month is 1343.33`]);
  });

  it("passes the schedule's month, and leaves a month with more than pay in it", () => {
    const one = {
      ...flat("$20,955.95", 2_095_595, 2_095_595),
      "income.scheduleMonthCents": 134_333,
    };
    expect(sameFigures(one)).toEqual([]);
    expect(
      sameFigures({ ...one, "income.monthlyCents": 182_625, "income.payOnly": false }),
    ).toEqual([]);
  });

  it("passes one figure, and a year with more than pay in it", () => {
    expect(sameFigures(flat("$20,955.95", 2_095_595, 2_095_595))).toEqual([]);
    expect(sameFigures(flat("$28,489.50", 2_848_950, 2_095_595, false))).toEqual([]);
  });
});
