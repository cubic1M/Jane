import { FORECAST_DAYS, FORECAST_SUBTYPES } from "@/config/detection";
import { expectedDates, incomeStreams, upcomingBills, type Expected } from "@/detection/forecast";
import type { DetectionInput } from "@/detection/types";
import { addDays } from "@/detection/units";

// "Safe to spend until payday": checking balance today, minus regular bills from
// checking before the next expected deposit, minus what's left in this month's budgets,
// minus this month's amounts toward goals. Each part comes from the page that shows it
// (bills forecast, budgets, goals), so the number reconciles with them. Math only.

export type SafeToSpend = {
  // The next expected deposit, or null when none is expected in the forecast window.
  payday: string | null;
  balanceCents: number;
  bills: Expected[];
  billsCents: number;
  budgetsLeftCents: number;
  goalsCents: number;
  safeCents: number;
};

export function safeToSpend(
  input: DetectionInput,
  { budgetsLeftCents, goalsCents }: { budgetsLeftCents: number; goalsCents: number },
): SafeToSpend {
  const checking = input.accounts.filter(
    (a) =>
      a.type === "depository" &&
      FORECAST_SUBTYPES.includes(a.subtype ?? "") &&
      a.currentBalanceCents !== null,
  );
  const checkingIds = new Set(checking.map((a) => a.id));
  const balance = checking.reduce((sum, a) => sum + (a.currentBalanceCents ?? 0), 0);

  const until = addDays(input.asOf, FORECAST_DAYS);
  const payday =
    incomeStreams(input)
      .filter((s) => s.active)
      .flatMap((s) => expectedDates(s, input.asOf, until))
      .filter((date) => date > input.asOf)
      .sort()[0] ?? null;

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
    safeCents: balance - billsCents - budgetsLeftCents - goalsCents,
  };
}
