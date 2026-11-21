import { describe, expect, it } from "vitest";
import { incomeYearWithoutPaychecks } from "./student-loans";

// With no paychecks, the income the student loan plans use (the card and /loans/student both):
// a contractor's or a pension's year, never what's left in the accounts (debug 3, rule 83, 11-20).
const facts = (pattern: string, monthly: number | null) => ({
  income_pattern: { value: pattern },
  monthly_income: { value: monthly },
});

describe("a year of income without paychecks", () => {
  it("is a contractor's or a pension's month times twelve", () => {
    expect(incomeYearWithoutPaychecks(facts("uneven", 586_806))).toBe(7_041_672);
    expect(incomeYearWithoutPaychecks(facts("pension", 195_000))).toBe(2_340_000);
  });

  it("is unknown for deposits Jane can't place as pay, or none", () => {
    // The demo bank with its paychecks gone: $183.50 a month left in the accounts isn't pay.
    expect(incomeYearWithoutPaychecks(facts("unknown", 18_350))).toBeNull();
    // A business's deposits are its sales.
    expect(incomeYearWithoutPaychecks(facts("business", 900_000))).toBeNull();
    expect(incomeYearWithoutPaychecks(facts("uneven", 0))).toBeNull();
    expect(incomeYearWithoutPaychecks(facts("uneven", null))).toBeNull();
  });
});
