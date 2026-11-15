import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "./build";
import { inputFor } from "./sample";

// Debugger 11-15: a bank's data runs to yesterday. On a payday the year counted back from today
// left out last year's paycheck on that date, and today's wasn't in yet: 23 paychecks in a year,
// so pay read about 4% low for a day and the demo person's car refinance was turned down at
// midnight, over the lenders' debt limit.

// Paid $2,500 on the 1st and the 15th, from 2025-11-15 to 2026-11-01: a year of paychecks.
const paydays = Array.from({ length: 24 }, (_, i) => {
  const month = 10 + Math.floor((i + 1) / 2);
  const day = (i + 1) % 2 === 0 ? "01" : "15";
  return `${2025 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}-${day}`;
});

const on = (today: string): ProfileInput => {
  const base = inputFor("renter");
  return {
    ...base,
    today,
    transactions: [
      ...paydays.map((date) => ({
        date,
        amountCents: -250_000,
        description: "ACME CORP PAYROLL",
        pfc: "INCOME_WAGES",
        accountId: base.accounts[0].id,
      })),
      // Spending on most days, as a bank's data has: from the day after the first payday to
      // yesterday, where the data ends.
      ...["2025-11-16", "2026-11-14"].map((date) => ({
        date,
        amountCents: 4_500,
        description: "CORNER GROCERY",
        pfc: "FOOD_AND_DRINK_GROCERIES",
        accountId: base.accounts[0].id,
      })),
    ],
  };
};

const pay = (today: string) => buildProfile(on(today)).facts.monthly_income.value;

describe("a year of pay, read on a payday", () => {
  it("has 24 paychecks across the year", () => {
    expect(paydays[0]).toBe("2025-11-15");
    expect(paydays.at(-1)).toBe("2026-11-01");
  });

  it("reads the same on payday, before the paycheck is in, as the day before", () => {
    expect(pay("2026-11-14")).toBe(500_000);
    expect(pay("2026-11-15")).toBe(500_000);
  });
});
