import { describe, expect, it } from "vitest";
import { DETECTOR_RATES } from "@/config/detectors";
import { buildProfile, rateMonthsOf, type ProfileInput } from "@/profile/build";
import { studentYearOf } from "./student-tax";

// Debug 2, desktop sweep 7, upload S6 (11-19: 14 months of Wells Fargo checking from Sep 2025,
// UC pay of about $625 every two weeks): California's renter's credit said "income near
// $18,744.80 a year". It took this year's pay (Jan 1 – Nov 14, 10.5 months) and paced it over the
// whole history's 12 months.

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const paydays = Array.from({ length: 31 }, (_, i) => addDays("2025-09-26", i * 14));
const data: ProfileInput = {
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
      pfc: "INCOME_SALARY",
      accountId: "chk",
    })),
};

describe("a year of pay from more than a year of data", () => {
  it("is this year's pay paced over this year's months, about 26 paychecks grossed up", () => {
    const year = studentYearOf(data, buildProfile(data).facts, rateMonthsOf(buildProfile(data)));
    const yearOfPay = 26 * 62_500 * DETECTOR_RATES.tax.netToGross;
    expect(Math.abs(year.wagesCents - yearOfPay) / yearOfPay).toBeLessThan(0.05);
  });
});
