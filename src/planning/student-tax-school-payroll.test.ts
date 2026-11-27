import { describe, expect, it } from "vitest";
import { buildProfile, rateMonthsOf, type ProfileInput } from "@/profile/build";
import { studentYearOf } from "./student-tax";

// CodeRabbit (the estimator review, 11-27): pay from a school's payroll is already in a student's
// wages; a bank that files the same deposit as gig or contractor income made it count again as gig
// income.
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const paydays = Array.from({ length: 22 }, (_, i) => addDays("2026-01-09", i * 14));

const data = (pfc: string): ProfileInput => ({
  today: "2026-11-19",
  accounts: [{ id: "chk", type: "depository", subtype: "checking", balanceCents: 141_222 }],
  liabilities: [],
  told: {},
  transactions: paydays
    .filter((d) => d <= "2026-11-14")
    .map((date) => ({
      date,
      amountCents: -62_500,
      description: "UNIV OF CALIF PAYROLL PPD",
      pfc,
      accountId: "chk",
    })),
});

const yearOf = (pfc: string) => {
  const d = data(pfc);
  const p = buildProfile(d);
  return studentYearOf(d, p.facts, rateMonthsOf(p));
};

describe("a school's payroll filed by the bank as gig or contractor income", () => {
  it.each(["INCOME_GIG_ECONOMY", "INCOME_CONTRACTOR"])(
    "%s is wages once, not gig income too",
    (pfc) => {
      const year = yearOf(pfc);
      expect(year.gigCents).toBe(0);
      // The same deposits filed as salary give the same year.
      expect(year).toEqual(yearOf("INCOME_SALARY"));
      expect(year.earnedCents).toBe(year.wagesCents);
    },
  );

  it("still counts gig pay from someone who is not a school", () => {
    const base = data("INCOME_SALARY");
    const d: ProfileInput = {
      ...base,
      transactions: [
        ...base.transactions,
        {
          date: "2026-10-01",
          amountCents: -90_000,
          description: "UBER DRIVER PAYOUT",
          pfc: "INCOME_GIG_ECONOMY",
          accountId: "chk",
        },
      ],
    };
    const p = buildProfile(d);
    expect(studentYearOf(d, p.facts, rateMonthsOf(p)).gigCents).toBeGreaterThan(0);
  });
});
