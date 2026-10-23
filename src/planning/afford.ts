import { AFFORD_MONTHS, MAX_GOAL_MONTHS } from "@/config/afford";
import { FORECAST_DAYS } from "@/config/detection";
import { addDays } from "@/detection/units";
import { goalProgress, type GoalInput } from "./goals";

// "Can I afford this?" (spec step 69): what a one-time purchase or a monthly change does
// to safe to spend, each savings goal and the month-end checking balance for the next 12
// months, before and after. Math only, never a recommendation (see afford-copy.ts). Pure;
// dates are YYYY-MM-DD, months YYYY-MM, money in cents.

// A dated amount on checking: money in is positive, money out negative.
export type Flow = { date: string; amountCents: number };

export type AffordNumbers = {
  asOf: string;
  // Safe to spend as Home shows it, or null when there's no checking account.
  safe: { payday: string | null; balanceCents: number; safeCents: number } | null;
  // Expected deposits and regular bills on checking through the last month shown.
  flows: Flow[];
  // Everyday spending a month besides those regular bills: the usual monthly spending What if
  // uses (the health score's average), less the bills already in `flows`. Taken out of each
  // month's end balance, so the two pages agree on when money runs short.
  everydayMonthlyCents?: number;
  goals: (GoalInput & { id: string; name: string })[];
};

export type AffordChange =
  | { kind: "purchase"; amountCents: number; date: string }
  // Positive is more going out each month, negative is less. It counts from the 1st of
  // the starting month, or from today when that's this month.
  | { kind: "monthly"; amountCents: number; startMonth: string };

export type GoalEffect =
  // A purchase taken from a goal's savings: the monthly amount to still reach it on time.
  | {
      kind: "monthly_needed";
      id: string;
      name: string;
      targetDate: string;
      beforeCents: number;
      afterCents: number;
    }
  // A monthly change taken from (or added to) what goes to a goal each month: when it's
  // reached at each pace, or null when that isn't within MAX_GOAL_MONTHS.
  | {
      kind: "reached_by";
      id: string;
      name: string;
      beforeMonthlyCents: number;
      afterMonthlyCents: number;
      before: string | null;
      after: string | null;
    };

export type MonthEnd = { month: string; beforeCents: number; afterCents: number };

export type AffordResult = {
  safe: { payday: string | null; beforeCents: number; afterCents: number } | null;
  months: MonthEnd[] | null;
  // The first month whose end balance is below zero, before and after the change.
  firstShort: { before: string | null; after: string | null } | null;
  goals: GoalEffect[];
};

export const monthOf = (date: string) => date.slice(0, 7);

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// The same day n months later, clamped to the month's last day (Jan 31 + 1 is Feb 28).
function addMonths(date: string, n: number): string {
  const month = shiftMonth(monthOf(date), n);
  const day = Math.min(Number(date.slice(8, 10)), Number(monthEnd(month).slice(8, 10)));
  return `${month}-${String(day).padStart(2, "0")}`;
}

// The months shown, this month first, and the last day they cover.
export function affordWindow(asOf: string): { months: string[]; until: string } {
  const months = Array.from({ length: AFFORD_MONTHS }, (_, k) => shiftMonth(monthOf(asOf), k));
  return { months, until: monthEnd(months[months.length - 1]) };
}

// The change as money moving on checking, within the window.
function changeFlows(change: AffordChange, asOf: string): Flow[] {
  if (change.kind === "purchase") return [{ date: change.date, amountCents: -change.amountCents }];
  return affordWindow(asOf)
    .months.filter((m) => m >= change.startMonth)
    .map((m) => ({
      date: m === monthOf(asOf) ? asOf : `${m}-01`,
      amountCents: -change.amountCents,
    }));
}

const total = (flows: Flow[]) => flows.reduce((sum, f) => sum + f.amountCents, 0);

// Contributions are monthly, this month first, as in goals.ts; the goal is reached on
// the same day of the month after the one that fills it.
function reachedBy(leftCents: number, asOf: string, paceAt: (month: string) => number) {
  let saved = 0;
  for (let k = 0; k < MAX_GOAL_MONTHS; k += 1) {
    saved += Math.max(0, paceAt(shiftMonth(monthOf(asOf), k)));
    if (saved >= leftCents) return addMonths(asOf, k + 1);
  }
  return null;
}

function goalEffects(numbers: AffordNumbers, change: AffordChange): GoalEffect[] {
  const { asOf } = numbers;
  return numbers.goals.flatMap((goal): GoalEffect[] => {
    const p = goalProgress(goal, asOf);
    if (p.status !== "on_the_way") return [];
    if (change.kind === "purchase") {
      const counts = change.date < goal.targetDate;
      return [
        {
          kind: "monthly_needed",
          id: goal.id,
          name: goal.name,
          targetDate: goal.targetDate,
          beforeCents: p.monthlyCents,
          afterCents: counts
            ? Math.ceil((p.leftCents + change.amountCents) / p.monthsLeft)
            : p.monthlyCents,
        },
      ];
    }
    const after = p.monthlyCents - change.amountCents;
    return [
      {
        kind: "reached_by",
        id: goal.id,
        name: goal.name,
        beforeMonthlyCents: p.monthlyCents,
        afterMonthlyCents: Math.max(0, after),
        before: reachedBy(p.leftCents, asOf, () => p.monthlyCents),
        after: reachedBy(p.leftCents, asOf, (m) =>
          m >= change.startMonth ? after : p.monthlyCents,
        ),
      },
    ];
  });
}

export function affordCheck(numbers: AffordNumbers, change: AffordChange): AffordResult {
  const { asOf, safe } = numbers;
  const goals = goalEffects(numbers, change);
  if (!safe) return { safe: null, months: null, firstShort: null, goals };

  const added = changeFlows(change, asOf);
  // Safe to spend covers today up to the day before payday, or the bills window without one.
  const inSafeWindow = (date: string) =>
    date >= asOf && (safe.payday ? date < safe.payday : date <= addDays(asOf, FORECAST_DAYS));

  // Everyday spending through each month's end: the rest of this month, then whole months.
  const everyday = numbers.everydayMonthlyCents ?? 0;
  const daysIn = (month: string) => Number(monthEnd(month).slice(8, 10));
  const thisMonth = monthOf(asOf);
  const restOfThisMonth = (daysIn(thisMonth) - Number(asOf.slice(8, 10))) / daysIn(thisMonth);
  const months = affordWindow(asOf).months.map((month, k) => {
    const end = monthEnd(month);
    const upTo = (flows: Flow[]) => total(flows.filter((f) => f.date <= end));
    const spent = Math.round(everyday * (restOfThisMonth + k));
    const beforeCents = safe.balanceCents + upTo(numbers.flows) - spent;
    return { month, beforeCents, afterCents: beforeCents + upTo(added) };
  });
  const firstBelow = (key: "beforeCents" | "afterCents") =>
    months.find((m) => m[key] < 0)?.month ?? null;

  return {
    safe: {
      payday: safe.payday,
      beforeCents: safe.safeCents,
      afterCents: safe.safeCents + total(added.filter((f) => inSafeWindow(f.date))),
    },
    months,
    firstShort: { before: firstBelow("beforeCents"), after: firstBelow("afterCents") },
    goals,
  };
}
