import {
  SIMULATED_NEW_CARD_LIMIT_CENTS,
  STATEMENT_LEAD_DAYS,
  STATEMENT_PAY_DAYS_BEFORE,
  STREAK_MILESTONES,
  THIN_FILE_ACCOUNTS,
  THIN_FILE_AGE_MONTHS,
} from "@/config/credit-building";
import { UTILISATION_GOOD, UTILISATION_HIGH } from "@/config/debt";
import type { CreditChange, CreditRequest } from "@/lib/credit/partner";
import { DAY_MS } from "@/lib/dates";

// Building credit (spec step 175). Pure: when a card's next statement closes and what to
// pay before it, the on-time streak, whether a file is thin, and the changes the score
// simulator tries.

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const iso = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (day: string, days: number) => iso(dayNumber(day) + days);

// The same day of a later month, or that month's last day when it's shorter.
function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)) / DAY_MS);
}

// The next statement after `asOf`, a month at a time from the last one.
export function nextStatementClose(lastIssue: string, asOf: string): string {
  let next = lastIssue;
  for (let i = 1; next <= asOf && i < 24; i += 1) next = addMonths(lastIssue, i);
  return next;
}

export type StatementPlan = {
  closesOn: string;
  // The day to pay so it posts before the statement closes.
  payOn: string;
  // Within STATEMENT_LEAD_DAYS of closing: time to act.
  due: boolean;
  // What to pay so the reported balance is under 30% and under 10% of the limits.
  toUnderHighCents: number;
  toUnderGoodCents: number;
};

export function statementPlan(input: {
  lastIssue: string;
  asOf: string;
  balanceCents: number;
  limitCents: number;
}): StatementPlan | null {
  if (input.limitCents <= 0) return null;
  const closesOn = nextStatementClose(input.lastIssue, input.asOf);
  const over = (share: number) =>
    Math.max(0, Math.ceil(input.balanceCents - share * input.limitCents));
  const payOn = addDays(closesOn, -STATEMENT_PAY_DAYS_BEFORE);
  return {
    closesOn,
    payOn: payOn < input.asOf ? input.asOf : payOn,
    due: dayNumber(closesOn) - dayNumber(input.asOf) <= STATEMENT_LEAD_DAYS,
    toUnderHighCents: over(UTILISATION_HIGH),
    toUnderGoodCents: over(UTILISATION_GOOD),
  };
}

// The payment to make: under 10% when checking can spare it and keep its cushion, else
// under 30%, else none. Zero when the balance is already under 30%.
export function statementAmount(
  plan: StatementPlan,
  spareCents: number,
): { amountCents: number; target: "good" | "high" } | null {
  if (plan.toUnderHighCents <= 0 && plan.toUnderGoodCents <= 0) return null;
  if (plan.toUnderGoodCents > 0 && plan.toUnderGoodCents <= spareCents) {
    return { amountCents: plan.toUnderGoodCents, target: "good" };
  }
  if (plan.toUnderHighCents > 0 && plan.toUnderHighCents <= spareCents) {
    return { amountCents: plan.toUnderHighCents, target: "high" };
  }
  return null;
}

export type Streak = {
  // Whole months in a row with every payment on time.
  months: number;
  // The last late fee or the first day Jane can see, YYYY-MM-DD.
  since: string;
  // No late payment in everything Jane can see.
  clean: boolean;
  // The highest STREAK_MILESTONES reached, or null.
  milestone: number | null;
};

const monthsBetween = (from: string, to: string) => {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
};

// From late fees' dates and whether anything is overdue now. `historyStart` is the first
// day Jane can see.
export function onTimeStreak(
  lateFees: readonly string[],
  overdue: boolean,
  asOf: string,
  historyStart: string,
): Streak {
  if (overdue) return { months: 0, since: asOf, clean: false, milestone: null };
  const last = [...lateFees].sort().at(-1);
  const since = last ?? historyStart;
  const months = monthsBetween(since, asOf);
  const reached = STREAK_MILESTONES.filter((m) => months >= m);
  return { months, since, clean: !last, milestone: reached.at(-1) ?? null };
}

export const thinFile = (creditAccounts: number, averageAgeMonths: number) =>
  creditAccounts < THIN_FILE_ACCOUNTS || averageAgeMonths < THIN_FILE_AGE_MONTHS;

export type SimulationKey =
  "pay_to_30" | "pay_to_10" | "pay_off_cards" | "on_time_year" | "new_card" | "builder_loan";

export type Simulation = { key: SimulationKey; label: string; change: CreditChange };

// The changes the simulator tries for this person: only ones that change something.
export function simulations(
  request: CreditRequest,
  limitCents: number,
  { thin }: { thin: boolean },
): Simulation[] {
  const out: Simulation[] = [];
  const balance = request.cardBalanceCents;
  const at = (share: number) => Math.floor(share * limitCents);
  if (limitCents > 0 && balance > at(UTILISATION_HIGH)) {
    out.push({
      key: "pay_to_30",
      label: "Pay your cards down to under 30% of their limits",
      change: { cardBalanceCents: at(UTILISATION_HIGH) - 1 },
    });
  }
  if (limitCents > 0 && balance > at(UTILISATION_GOOD)) {
    out.push({
      key: "pay_to_10",
      label: "Pay your cards down to under 10% of their limits",
      change: { cardBalanceCents: at(UTILISATION_GOOD) - 1 },
    });
  }
  if (balance > 0) {
    out.push({
      key: "pay_off_cards",
      label: "Pay your cards off in full",
      change: { cardBalanceCents: 0 },
    });
  }
  if (request.lateFeesLastYear > 0) {
    out.push({
      key: "on_time_year",
      label: "A year with every payment on time",
      change: { lateFeesLastYear: 0 },
    });
  }
  out.push({
    key: "new_card",
    label: "Open a new card (a hard inquiry, and more limit)",
    change: { extraInquiries: 1, extraLimitCents: SIMULATED_NEW_CARD_LIMIT_CENTS },
  });
  if (thin && !request.hasInstallmentLoan) {
    out.push({
      key: "builder_loan",
      label: "A credit-builder loan, paid on time",
      change: { hasInstallmentLoan: true },
    });
  }
  return out;
}
