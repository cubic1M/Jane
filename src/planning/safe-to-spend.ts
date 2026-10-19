import { FORECAST_DAYS, FORECAST_SUBTYPES } from "@/config/detection";
import { upcomingBills, type Expected } from "@/detection/forecast";
import { nextPayday } from "@/detection/paydays";
import type { DetectionInput } from "@/detection/types";

// "Safe to spend until payday": checking balance today, minus regular bills from
// checking before the next expected deposit, minus what's left in this month's budgets,
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

  // Bills from checking up to the day before payday (or across the window without one).
  const bills = upcomingBills(input, FORECAST_DAYS).filter(
    (b) =>
      b.accountId !== null &&
      checkingIds.has(b.accountId) &&
      b.date > input.asOf &&
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
