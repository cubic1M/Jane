import { monthlyPayment } from "@/planning/home-equity";

// The sample loans agree with themselves (loans QA): a loan's payoff date is where its
// balance, rate and payment end it, so the payment the bank reports is the one every page
// shows and compares. A mortgage's payment is its principal and interest (from how it began,
// over 30 years, as Jane works it out) plus the escrow for taxes and insurance; only the
// principal and interest pays the loan down.

const cents = (dollars: number) => Math.round(dollars * 100);
const bps = (percent: number) => Math.round(percent * 100);

// Principal and interest a month on a mortgage that began at `original`, in dollars.
export const mortgagePiDollars = (original: number, ratePercent: number, years = 30) =>
  monthlyPayment(cents(original), bps(ratePercent), years * 12) / 100;

// Whole months until `payment` a month pays off `balance` at the rate (the last one smaller).
export function monthsToPayOff(balance: number, ratePercent: number, payment: number): number {
  let left = cents(balance);
  const pay = cents(payment);
  const rate = bps(ratePercent) / 10_000 / 12;
  for (let month = 1; month <= 600; month += 1) {
    left += Math.round(left * rate) - pay;
    if (left <= 0) return month;
  }
  throw new Error(`A sample loan's payment of ${payment} doesn't pay off ${balance}`);
}

// The first of the month `months` after the day's month, YYYY-MM-DD.
export function monthsAfter(day: string, months: number): string {
  const total = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}
