import { describe, expect, it } from "vitest";
import { DETECTOR_RATES } from "@/config/detectors";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { studentYearOf } from "./student-tax";

// Pay on a schedule is a month by its usual paycheck (src/profile/pay-on-schedule.ts), so a bonus
// from the same employer isn't in "what you earn in a usual month". It is in the year the tax cards
// read: paid once, it adds once, grossed up as pay is (manager, #2165).

const USUAL = 62_000;
const BONUS = 100_000;
const today = "2026-11-19";
const pay = (date: string, cents = USUAL) => ({
  date,
  amountCents: -cents,
  description: "UNIV OF CALIFORNIA PAYROLL PPD ID: 1234567890",
  pfc: "INCOME_SALARY",
  accountId: "chk",
});
// Every two weeks from Jul 9 to Nov 12: ten paychecks, all this year.
const PAYDAYS = [
  "2026-07-09",
  "2026-07-23",
  "2026-08-06",
  "2026-08-20",
  "2026-09-03",
  "2026-09-17",
  "2026-10-01",
  "2026-10-15",
  "2026-10-29",
  "2026-11-12",
];
const input = (transactions: ProfileInput["transactions"]): ProfileInput => ({
  today,
  accounts: [
    {
      id: "chk",
      name: "Chase checking",
      type: "depository",
      subtype: "checking",
      balanceCents: 90_000,
    },
  ],
  liabilities: [],
  told: {},
  transactions,
});
const yearOf = (data: ProfileInput) => {
  const profile = buildProfile(data);
  return {
    month: profile.facts.monthly_income.value as number,
    wages: studentYearOf(data, profile.facts, profile.rateMonths ?? 1).wagesCents,
  };
};
const MONTH = Math.round((USUAL * 26) / 12);
const YEAR = Math.round(MONTH * 12 * DETECTOR_RATES.tax.netToGross);
const GROSS_BONUS = Math.round(BONUS * DETECTOR_RATES.tax.netToGross);

describe("a bonus from an employer that pays on a schedule", () => {
  it("leaves a usual month and a usual year as the schedule's", () => {
    expect(yearOf(input(PAYDAYS.map((d) => pay(d))))).toEqual({ month: MONTH, wages: YEAR });
  });

  it("adds a bonus paid on a day of its own to the year, once, not to the month", () => {
    const data = input([...PAYDAYS.map((d) => pay(d)), pay("2026-10-22", BONUS)]);
    expect(yearOf(data)).toEqual({ month: MONTH, wages: YEAR + GROSS_BONUS });
  });

  it("adds a bonus paid with a paycheck to the year, once, not to the month", () => {
    const data = input(PAYDAYS.map((d) => pay(d, d === "2026-10-29" ? USUAL + BONUS : USUAL)));
    expect(yearOf(data)).toEqual({ month: MONTH, wages: YEAR + GROSS_BONUS });
  });
});
