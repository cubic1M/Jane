import type { PinwheelEmployment, PinwheelPaystub } from "./api";

// Pinwheel's own examples (docs.pinwheelapi.com, Core Data Technical Implementation: the Employment and
// Paystubs responses, read 2026-11-19), cut to the fields Jane reads. The tests read them as Pinwheel
// sends them; the sandbox twin moves the stub's dates so it was paid five days before the person's day.

export const PINWHEEL_DOCS_EMPLOYMENT: PinwheelEmployment = {
  status: "employed",
  title: "Sales Associate",
  start_date: "2019-03-27",
  employer_name: "Walmart",
};

export const PINWHEEL_DOCS_PAYSTUBS: PinwheelPaystub[] = [
  {
    id: "497f6eca-6276-4993-bfeb-53cbbbba6f08",
    pay_date: "2020-12-31",
    pay_period_start: "2020-12-10",
    pay_period_end: "2020-12-24",
    currency: "usd",
    gross_pay_amount: 480769,
    net_pay_amount: 273563,
    deductions: [
      { name: "Aetna PPO", category: "medical_insurance", amount: 7012 },
      { name: "401(k) deferral", category: "retirement", amount: 57692 },
      { name: "Transit", category: "commuter", amount: 2000 },
    ],
  },
];

const DAY = 86_400_000;
const move = (day: string | null | undefined, by: number) =>
  day ? new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY).toISOString().slice(0, 10) : day;

// The same stub for a sample-data person, paid five days before `today` (YYYY-MM-DD).
export function samplePaystubs(today: string): PinwheelPaystub[] {
  const by =
    Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse("2020-12-31T00:00:00Z")) / DAY) - 5;
  return PINWHEEL_DOCS_PAYSTUBS.map((s) => ({
    ...s,
    pay_date: move(s.pay_date, by),
    pay_period_start: move(s.pay_period_start, by),
    pay_period_end: move(s.pay_period_end, by),
  }));
}
