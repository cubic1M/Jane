import { describe, expect, it } from "vitest";
import { DETECTOR_RATES } from "@/config/detectors";
import { buildProfile, rateMonthsOf, type ProfileInput } from "@/profile/build";
import { studentYearOf } from "./student-tax";

// Gate C (11-20): the year in progress was this year's pay paced over the months the data covers,
// and those months hold a fence-post's worth of paydays too many or too few. The renter's 20
// paychecks twice a month by Oct 23 paced to 24.68 a year ($52,615.68, 2.8% over the schedule's
// 24); 12 by June 20 paced to 25.6. Beside income limits that can flip a card. The year is what
// was paid, each paycheck once, and the paydays left by Dec 31 for each employer still paying.

const NTG = DETECTOR_RATES.tax.netToGross;
const pay = (dates: string[], amountCents: number, description: string) =>
  dates.map((date) => ({ date, amountCents, description, pfc: "INCOME_SALARY", accountId: "chk" }));
const input = (today: string, transactions: ProfileInput["transactions"]): ProfileInput => ({
  today,
  accounts: [{ id: "chk", type: "depository", subtype: "checking", balanceCents: 400_000 }],
  liabilities: [],
  told: {},
  transactions,
});
const wagesOf = (data: ProfileInput) => {
  const profile = buildProfile(data);
  return studentYearOf(data, profile.facts, rateMonthsOf(profile)).wagesCents;
};
// The 15th and the last day of each month from October 2025.
const twiceMonthly = (until: string) =>
  Array.from({ length: 30 }, (_, i) => {
    const month = new Date(Date.UTC(2025, 9 + Math.floor(i / 2), 1));
    const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    return (i % 2 ? end : new Date(month.getTime() + 14 * 86_400_000)).toISOString().slice(0, 10);
  }).filter((d) => d <= until);

describe("the year in progress, from data that starts before January", () => {
  it("is 24 paychecks twice a month on Dec 31, data ending Oct 24", () => {
    const data = input(
      "2026-12-31",
      pay(twiceMonthly("2026-10-24"), -164_000, "ACME CORP PAYROLL PPD"),
    );
    expect(wagesOf(data)).toBe(Math.round(24 * 164_000 * NTG));
  });

  it("is 24 paychecks twice a month on June 30, mid-year", () => {
    const data = input(
      "2026-06-30",
      pay(twiceMonthly("2026-06-20"), -164_000, "ACME CORP PAYROLL PPD"),
    );
    expect(wagesOf(data)).toBe(Math.round(24 * 164_000 * NTG));
  });

  it("counts a bonus that was paid once, on top of the year's paychecks", () => {
    const lines = [
      ...pay(twiceMonthly("2026-10-24"), -164_000, "ACME CORP PAYROLL PPD"),
      ...pay(["2026-03-15"], -100_000, "ACME CORP PAYROLL PPD"),
    ];
    expect(wagesOf(input("2026-12-31", lines))).toBe(Math.round((24 * 164_000 + 100_000) * NTG));
  });

  it("leaves a year with no pay in it yet to the month (Jan 1, taxYearTurned)", () => {
    const data = input(
      "2027-01-01",
      pay(twiceMonthly("2026-10-24"), -164_000, "ACME CORP PAYROLL PPD"),
    );
    expect(wagesOf(data)).toBe(0);
  });
});
