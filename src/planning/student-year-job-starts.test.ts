import { describe, expect, it } from "vitest";
import { DETECTOR_RATES } from "@/config/detectors";
import { yearIncomeOf } from "@/detectors/helpers";
import { buildProfile, rateMonthsOf, type ProfileInput } from "@/profile/build";
import { studentYearOf } from "./student-tax";

// Manager, 11-20 (#2204): in data that starts this year, pay on a schedule was a month of it as a
// year, right only when the pay runs from the data's start. A TA's statements from Jun 1 with a first
// paycheck on Oct 1, then twice a month, read on Nov 20: the year is the 4 paychecks paid and the 3
// paydays left (Dec 1, Dec 15, and Jan 1's, paid Dec 31 before the holiday), not 24. The income-near cards (the Saver's Credit reads
// yearIncomeOf) and the federal estimate (tax-estimate-pay-schedule.integration.test.ts) read one year.

const NTG = DETECTOR_RATES.tax.netToGross;
const PAY = 150_000;
const stanford = (dates: string[]) =>
  dates.map((date) => ({
    date,
    amountCents: -PAY,
    description: "STANFORD UNIV DES:PAYROLL ID:X",
    pfc: "INCOME_SALARY",
    accountId: "chk",
  }));
// A coffee on the statements' first day, so the data starts Jun 1.
const opened = {
  date: "2026-06-01",
  amountCents: 450,
  description: "STARBUCKS",
  pfc: "FOOD_AND_DRINK_COFFEE",
  accountId: "chk",
};
const input = (transactions: ProfileInput["transactions"]): ProfileInput => ({
  today: "2026-11-20",
  accounts: [{ id: "chk", type: "depository", subtype: "checking", balanceCents: 400_000 }],
  liabilities: [],
  told: {},
  transactions: [opened, ...transactions],
});
const year = (data: ProfileInput) => {
  const profile = buildProfile(data);
  return {
    wages: studentYearOf(data, profile.facts, rateMonthsOf(profile)).wagesCents,
    savers: yearIncomeOf(profile, data),
  };
};

describe("a job on a schedule, in data that starts this year", () => {
  it("starting Oct 1 in statements from Jun 1: what it paid and its paydays left", () => {
    // The 15th of November is a Sunday and the 1st a Sunday: paid the Friday before.
    const data = input(stanford(["2026-10-01", "2026-10-15", "2026-10-30", "2026-11-13"]));
    expect(year(data)).toEqual({
      wages: Math.round(7 * PAY * NTG),
      savers: Math.round(7 * PAY * NTG),
    });
  });

  it("paying from the statements' first days: a month of its schedule as a year", () => {
    const data = input(
      stanford([
        "2026-06-01",
        "2026-06-15",
        "2026-07-01",
        "2026-07-15",
        "2026-07-31",
        "2026-08-14",
        "2026-09-01",
        "2026-09-15",
        "2026-10-01",
        "2026-10-15",
        "2026-10-30",
        "2026-11-13",
      ]),
    );
    expect(year(data)).toEqual({
      wages: Math.round(2 * PAY * 12 * NTG),
      savers: Math.round(2 * PAY * 12 * NTG),
    });
  });
});
