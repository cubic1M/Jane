import {
  FORECAST_DAYS,
  FORECAST_SUBTYPES,
  OWN_MOVE_DAYS,
  PAYMENT_TRANSFERS,
} from "@/config/detection";
import {
  scheduledTransfers,
  scheduledTransfersIn,
  upcomingBills,
  type Expected,
} from "@/detection/forecast";
import { daysBetween } from "@/detection/units";
import { nextPayday } from "@/detection/paydays";
import type { DetectionInput } from "@/detection/types";

// "Safe to spend until payday": checking balance today, minus regular bills and regular moves
// out (to savings, or a Zelle that may be rent) from checking before the next expected deposit, minus what's left in this month's budgets,
// minus this month's amounts toward goals, minus this month's set-aside for yearly bills
// (spec step 70). Each part comes from the page that shows it (bills forecast, budgets,
// goals), so the number reconciles with them. Math only.

export type SafeToSpend = {
  // The next expected paycheck, or null when none is expected in the forecast window.
  payday: string | null;
  balanceCents: number;
  bills: Expected[];
  billsCents: number;
  budgetsLeftCents: number;
  goalsCents: number;
  setAsideCents: number;
  safeCents: number;
};

export function safeToSpend(
  input: DetectionInput,
  {
    budgetsLeftCents,
    goalsCents,
    setAsideCents = 0,
  }: { budgetsLeftCents: number; goalsCents: number; setAsideCents?: number },
): SafeToSpend {
  const checking = input.accounts.filter(
    (a) =>
      a.type === "depository" &&
      FORECAST_SUBTYPES.includes(a.subtype ?? "") &&
      a.currentBalanceCents !== null,
  );
  const checkingIds = new Set(checking.map((a) => a.id));
  const balance = checking.reduce((sum, a) => sum + (a.currentBalanceCents ?? 0), 0);

  // The next paycheck (spec step 182): payroll deposits only, never interest or a refund.
  const payday = nextPayday(input, FORECAST_DAYS)?.date ?? null;

  // Bills and regular moves out that may be payments to others (Zelle, Venmo, "transfer to")
  // from checking up to the day before payday (or across the window without one), as the
  // forecast takes them out (debugger 10-30: rent sent by Zelle left checking in the forecast but
  // not here, so safe to spend was $1,400 too high). Not moves to savings, investments or cash:
  // a goal's monthly amount already holds those back. Not a move into another of the person's
  // checking accounts: it's still in checking (review 10-31).
  const arriving = scheduledTransfersIn(input, FORECAST_DAYS).filter(
    (t) => t.accountId !== null && checkingIds.has(t.accountId),
  );
  const toOwnChecking = (t: Expected) =>
    arriving.some(
      (a) =>
        a.accountId !== t.accountId &&
        a.amountCents === t.amountCents &&
        Math.abs(daysBetween(a.date, t.date)) <= OWN_MOVE_DAYS,
    );
  const bills = [
    ...upcomingBills(input, FORECAST_DAYS),
    ...scheduledTransfers(input, FORECAST_DAYS, PAYMENT_TRANSFERS).filter((t) => !toOwnChecking(t)),
  ]
    .sort((a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant))
    .filter(
      (b) =>
        b.accountId !== null &&
        checkingIds.has(b.accountId) &&
        // Due today counts: one that has posted already moved the next date on, so a bill dated
        // today is still to come out (phone walk: an evening in the US is the next day in UTC,
        // and tomorrow's card payment dropped out, raising safe to spend by $1,640).
        b.date >= input.asOf &&
        (payday === null || b.date < payday),
    );
  const billsCents = bills.reduce((sum, b) => sum + b.amountCents, 0);
  return {
    payday,
    balanceCents: balance,
    bills,
    billsCents,
    budgetsLeftCents,
    goalsCents,
    setAsideCents,
    safeCents: balance - billsCents - budgetsLeftCents - goalsCents - setAsideCents,
  };
}
