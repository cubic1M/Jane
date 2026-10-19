import { BILL_PAY_LEAD_DAYS, BILL_PAY_MIN_LEFT_CENTS } from "@/config/money-movement";
import { addDays } from "@/detection/units";

// Bills paid on time (spec step 145). Pure: for a card or loan due soon that nothing is set
// to pay (no autopay from checking before the due date), the payment to schedule: the full
// balance if checking can take it, else the minimum, else none; never one that would take
// checking's forecast below zero on any day after it. And a due date that lands before
// payday while checking runs short is worth moving.

export type DueBill = {
  accountId: string;
  name: string;
  kind: string;
  dueOn: string;
  minimumCents: number;
  balanceCents: number | null;
  // The person's own regular payment from checking before the due date, if any.
  autopay: { date: string; amountCents: number } | null;
};

export type ForecastDay = { date: string; balanceCents: number };

export type BillPlan =
  | { status: "autopay"; bill: DueBill }
  | { status: "pay"; bill: DueBill; amountCents: number; runOn: string; full: boolean }
  | { status: "short"; bill: DueBill };

// The lowest checking balance from `from` on, after taking `cents` out on that day.
function lowestAfter(series: ForecastDay[], from: string, cents: number): number {
  const after = series.filter((d) => d.date >= from);
  if (after.length === 0) return Number.NEGATIVE_INFINITY;
  return Math.min(...after.map((d) => d.balanceCents)) - cents;
}

export function payDate(dueOn: string, today: string): string {
  const run = addDays(dueOn, -BILL_PAY_LEAD_DAYS);
  const tomorrow = addDays(today, 1);
  return run < tomorrow ? tomorrow : run;
}

export function billPlan(bill: DueBill, series: ForecastDay[], today: string): BillPlan {
  if (
    bill.autopay &&
    bill.autopay.amountCents >= bill.minimumCents &&
    bill.autopay.date <= bill.dueOn
  ) {
    return { status: "autopay", bill };
  }
  const runOn = payDate(bill.dueOn, today);
  const fits = (cents: number) =>
    cents > 0 && lowestAfter(series, runOn, cents) >= BILL_PAY_MIN_LEFT_CENTS;
  const full =
    bill.balanceCents !== null && bill.balanceCents > bill.minimumCents ? bill.balanceCents : null;
  if (full !== null && fits(full))
    return { status: "pay", bill, amountCents: full, runOn, full: true };
  if (fits(bill.minimumCents)) {
    return { status: "pay", bill, amountCents: bill.minimumCents, runOn, full: false };
  }
  return { status: "short", bill };
}

// A due date before payday on which checking runs short: worth asking to move it after.
export function dueDateMove(
  bill: DueBill,
  series: ForecastDay[],
  payday: string | null,
): string | null {
  if (!payday || bill.dueOn >= payday) return null;
  const onDue = series.find((d) => d.date === bill.dueOn);
  if (!onDue || onDue.balanceCents - bill.minimumCents >= BILL_PAY_MIN_LEFT_CENTS) return null;
  return addDays(payday, 1);
}
