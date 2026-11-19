import type { PayFrequency } from "@/config/benefits";
import type { Paystub } from "@/lib/insurance/payroll";
import type { PinwheelEmployment, PinwheelPaystub } from "./api";

// Pinwheel's pay stubs as Jane's (src/lib/insurance/payroll.ts): employer from the employment record,
// amounts already in cents, each deduction by its name (what Jane's benefit patterns read). Pinwheel
// says pay as an amount per unit, not how often it's paid, so the frequency comes from the gap between
// pay dates, or from the pay period when there's one stub. Stubs not in USD are left out.

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function payFrequency(stubs: readonly PinwheelPaystub[]): PayFrequency {
  const dates = stubs
    .map((s) => s.pay_date)
    .filter(isDay)
    .sort()
    .reverse();
  if (dates.length >= 2) {
    const gap = days(dates[1]!, dates[0]!);
    if (gap <= 8) return "weekly";
    if (gap <= 14) return "biweekly";
    if (gap <= 17) return "semimonthly";
    return "monthly";
  }
  const [stub] = stubs;
  if (stub && isDay(stub.pay_period_start) && isDay(stub.pay_period_end)) {
    const span = days(stub.pay_period_start, stub.pay_period_end);
    const startDay = Number(stub.pay_period_start.slice(8));
    if (span <= 7) return "weekly";
    // A half-month period starts on the 1st or the 16th.
    if (span <= 16) return startDay === 1 || startDay === 16 ? "semimonthly" : "biweekly";
  }
  return "monthly";
}

// Newest first.
export function pinwheelPaystubs(
  employment: PinwheelEmployment,
  stubs: readonly PinwheelPaystub[],
): Paystub[] {
  const employer = employment.employer_name?.trim();
  if (!employer) return [];
  const frequency = payFrequency(stubs);
  return stubs
    .filter(
      (s) =>
        isDay(s.pay_date) &&
        (s.currency ?? "usd").toLowerCase() === "usd" &&
        Number.isInteger(s.gross_pay_amount) &&
        Number.isInteger(s.net_pay_amount),
    )
    .sort((a, b) => (a.pay_date! < b.pay_date! ? 1 : -1))
    .map((s) => ({
      employer,
      payDate: s.pay_date!,
      payFrequency: frequency,
      grossCents: s.gross_pay_amount!,
      netCents: s.net_pay_amount!,
      deductions: (s.deductions ?? []).flatMap((d) =>
        typeof d.name === "string" && d.name.trim() && Number.isInteger(d.amount)
          ? [{ label: d.name.trim().slice(0, 120), amountCents: d.amount! }]
          : [],
      ),
      openEnrollment: null,
    }));
}
