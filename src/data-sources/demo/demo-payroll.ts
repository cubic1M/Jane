import type { Paystub } from "@/lib/insurance/payroll";

// The stand-in payroll (spec step 150): the demo bank's ACME CORP paychecks as pay stubs,
// with the deductions a real one lists. Made up, and matched to the demo bank's $2,450.00 net
// pay on the 1st and 15th. Deterministic: the same day always gives the same stubs.

export const DEMO_EMPLOYER = "ACME CORP";

const DEDUCTIONS: readonly { label: string; amountCents: number }[] = [
  { label: "MEDICAL PPO EE+1", amountCents: 14_500 },
  { label: "DENTAL", amountCents: 1_200 },
  { label: "VISION", amountCents: 400 },
  { label: "SUPP LIFE 1X", amountCents: 850 },
  { label: "LTD", amountCents: 620 },
  { label: "HSA EE", amountCents: 10_000 },
  { label: "FSA HC", amountCents: 10_000 },
  { label: "401K 6%", amountCents: 21_600 },
  { label: "FED TAX", amountCents: 27_000 },
  { label: "SOC SEC", amountCents: 22_320 },
  { label: "MEDICARE", amountCents: 5_220 },
  { label: "STATE TAX", amountCents: 1_290 },
];
const GROSS_CENTS = 360_000;

const day = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

// The last two paydays (the 1st and 15th) on or before `today`.
function paydays(today: string): string[] {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const latest = d >= 15 ? day(y, m - 1, 15) : day(y, m - 1, 1);
  const before = d >= 15 ? day(y, m - 1, 1) : day(y, m - 2, 15);
  return [latest, before];
}

// ACME's open enrollment for next year: Nov 2–13, this year's if it hasn't ended yet.
function openEnrollment(today: string) {
  const y = Number(today.slice(0, 4));
  const end = day(y, 10, 13);
  const year = today > end ? y + 1 : y;
  return { start: day(year, 10, 2), end: day(year, 10, 13) };
}

// `today` is the person's day (gate C's calendar sweep, 11-16): by UTC's, the last day of open
// enrollment dropped off at 4pm in Los Angeles, and the 15th's pay stub came at 4pm on the 14th.
export function demoPaystubs(today: string): Paystub[] {
  return paydays(today).map((payDate) => ({
    employer: DEMO_EMPLOYER,
    payDate,
    payFrequency: "semimonthly",
    grossCents: GROSS_CENTS,
    netCents: GROSS_CENTS - DEDUCTIONS.reduce((sum, d) => sum + d.amountCents, 0),
    deductions: DEDUCTIONS.map((d) => ({ ...d })),
    openEnrollment: openEnrollment(today),
  }));
}
