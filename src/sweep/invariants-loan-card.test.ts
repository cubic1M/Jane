import { describe, expect, it } from "vitest";
import { sameFigures } from "./invariants";

// Class 4, a card against the page it opens (debug 2, sweep 7, Plaid + loans, 11-18): the student
// loan card said an income-driven plan "would ask roughly $139.98", 7% of take-home pay, and its
// "Compare repayment plans" opened /loans/student with RAP $41.36 and IBR $7.30 (#2114). The sweep
// now reads that page and holds the card's year of pay and monthly figure to it.

const why = (year: string, month: string) =>
  `You pay about $217.40 a month on student loans. If they're federal, the lowest income-driven plan at about ${year} a year of pay would ask about ${month} a month.`;
const page = {
  "loansStudent.agiCents": 2_399_668,
  "loansStudent.plans.current": 21_740,
  "loansStudent.plans.standard": 17_421,
  "loansStudent.plans.ibr": 730,
  "loansStudent.plans.rap": 4_136,
};

describe("the student loan card against /loans/student", () => {
  it("fails a card whose plan figure isn't the page's lowest", () => {
    expect(
      sameFigures({
        ...page,
        "suggestions.debt:student_repayment.why": why("$23,996.68", "$139.98"),
      }),
    ).toEqual([
      `suggestions.debt:student_repayment.why (a month): "$139.98", /loans/student's lowest income-driven plan a month is 7.3`,
    ]);
  });

  it("fails a card at another year of pay", () => {
    expect(
      sameFigures({
        ...page,
        "suggestions.debt:student_repayment.why": why("$28,489.50", "$7.30"),
      }),
    ).toEqual([
      `suggestions.debt:student_repayment.why (year): "$28,489.50", /loans/student's year of pay is 23996.68`,
    ]);
  });

  it("passes the page's figures, and no page to hold it to", () => {
    const card = { "suggestions.debt:student_repayment.why": why("$23,996.68", "$7.30") };
    expect(sameFigures({ ...page, ...card })).toEqual([]);
    expect(sameFigures({ "loansStudent.plans.rap": 4_136, ...card })).toEqual([
      `suggestions.debt:student_repayment.why (a month): "$7.30", /loans/student's lowest income-driven plan a month is 41.36`,
    ]);
    expect(sameFigures(card)).toEqual([]);
  });
});
