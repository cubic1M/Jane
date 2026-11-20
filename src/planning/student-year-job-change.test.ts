import { describe, expect, it } from "vitest";
import { DETECTOR_RATES } from "@/config/detectors";
import { buildProfile, rateMonthsOf, type ProfileInput } from "@/profile/build";
import { studentYearOf } from "./student-tax";

// The year turn's first fix (11-20) read the year's wages by pay schedule for everyone, so Dec 31
// would equal Jan 1's month as a year. The sweep's family changed jobs: Northwind Health paid until
// August and Meridian from September, and the schedules counted Meridian's whole year on top of
// Northwind's pay, 24,719,807 cents against 17,178,845 paid. A year with a job change is what was
// paid, paced, each paycheck once.

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const every14 = (from: string, until: string) =>
  Array.from({ length: 40 }, (_, i) => addDays(from, i * 14)).filter((d) => d <= until);
const pay = (dates: string[], amountCents: number, description: string) =>
  dates.map((date) => ({ date, amountCents, description, pfc: "INCOME_SALARY", accountId: "chk" }));
const old = every14("2025-10-03", "2026-08-14");
const next = every14("2026-09-04", "2026-10-24");
const data: ProfileInput = {
  today: "2026-12-31",
  accounts: [{ id: "chk", type: "depository", subtype: "checking", balanceCents: 400_000 }],
  liabilities: [],
  told: {},
  transactions: [
    ...pay(old, -300_000, "NORTHWIND HEALTH PAYROLL PPD"),
    ...pay(next, -380_000, "MERIDIAN SYSTEMS PAYROLL PPD"),
  ],
};

describe("a year's wages with a job change", () => {
  it("is what both jobs paid this year, paced over its months, each paycheck once", () => {
    const profile = buildProfile(data);
    const year = studentYearOf(data, profile.facts, rateMonthsOf(profile));
    const paid = old.filter((d) => d >= "2026-01-01").length * 300_000 + next.length * 380_000;
    // This year's months to the last payday, as the year's pace reads them.
    const last = next.at(-1)!;
    const span = ((Date.parse(last) - Date.parse("2026-01-01")) / 86_400_000 + 1) / (365.25 / 12);
    expect(year.wagesCents).toBe(
      Math.round(Math.round(paid / span) * 12 * DETECTOR_RATES.tax.netToGross),
    );
    // Not the new job's whole year by its schedule on top of the old job's pay.
    const newScheduleYear = Math.round(380_000 * 26 * DETECTOR_RATES.tax.netToGross);
    const oldPaid = Math.round(
      old.filter((d) => d >= "2026-01-01").length * 300_000 * DETECTOR_RATES.tax.netToGross,
    );
    expect(year.wagesCents).toBeLessThan(newScheduleYear + oldPaid);
    expect(year.extraPayCents).toBe(0);
  });
});
