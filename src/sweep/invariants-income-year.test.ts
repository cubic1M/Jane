import { describe, expect, it } from "vitest";
import { sameFigures } from "./invariants";

// Class 4 by year: in January a card for the year that just ended (the Saver's Credit, "2026 income
// near $X") reads that year's income, the snapshot's lastYearCents; one for this year, this year's.

const january = (short: string) => ({
  asOf: "2027-01-10",
  "income.monthlyCents": 328_000,
  "income.yearCents": 5_116_800,
  "income.lastYearCents": 5_261_568,
  "income.fromMonthCents": 5_116_800,
  "income.payOnly": false,
  "income.chatYearGross": "$51,168.00",
  "suggestions.taxes:savers_credit.short": short,
});

describe("income near, by the year it names", () => {
  it("holds a card for last year to last year's income, and this year's to this year's", () => {
    expect(sameFigures(january("2026 income near $52,615.68 is under its limit."))).toEqual([]);
    expect(sameFigures(january("2027 income near $51,168.00 is under its limit."))).toEqual([]);
  });

  it("fails a card for last year that shows this year's, and the other way round", () => {
    expect(sameFigures(january("2026 income near $51,168.00 is under its limit."))).toEqual([
      `suggestions.taxes:savers_credit.short: "$51,168.00", last year's income is 52615.68`,
    ]);
    expect(sameFigures(january("2027 income near $52,615.68 is under its limit."))).toEqual([
      `suggestions.taxes:savers_credit.short: "$52,615.68", the year's income is 51168`,
    ]);
  });
});
