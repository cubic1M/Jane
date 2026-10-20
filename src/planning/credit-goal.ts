import {
  CREDIT_GOAL_LABELS,
  GOAL_MAX_MONTHS,
  GOAL_MIN_MONTHS,
  RAPID_RESCORE_NOTE,
  type CreditGoalKind,
} from "@/config/credit-goals";
import { UTILISATION_GOOD } from "@/config/debt";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";

// A credit score for a goal (spec step 227). Pure: how many months a plan has, the paydown
// that brings card use under 10% spread over those months, and the checklist for each month
// (what to pay and when, accounts to keep open, no new applications, a rapid rescore before a
// mortgage application). The score each month comes from the simulator, passed in.

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addMonths = (day: string, months: number) => {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
};
export const monthOf = (day: string) => day.slice(0, 7);

// Whole months from today to the date, within what a plan can look at.
export function planMonths(asOf: string, targetDate: string): number {
  const [ay, am, ad] = asOf.split("-").map(Number);
  const [ty, tm, td] = targetDate.split("-").map(Number);
  const months = (ty - ay) * 12 + (tm - am) - (td < ad ? 1 : 0);
  return Math.max(GOAL_MIN_MONTHS, Math.min(GOAL_MAX_MONTHS, months));
}

// What card balance is left after each month's payment: the paydown needed to get under
// UTILISATION_GOOD of the limit, spread evenly over all but the last month (the last is for
// the rescore and the application).
export function paydownBalances(input: {
  balanceCents: number;
  limitCents: number;
  months: number;
}): number[] {
  const goal = Math.max(0, Math.floor(input.limitCents * UTILISATION_GOOD) - 1);
  const needed = Math.max(0, input.balanceCents - goal);
  const payMonths = Math.max(1, input.months - 1);
  const out: number[] = [];
  for (let i = 1; i <= input.months; i += 1) {
    const paid = Math.min(needed, Math.ceil((needed * Math.min(i, payMonths)) / payMonths));
    out.push(input.balanceCents - paid);
  }
  return out;
}

export type GoalItem = {
  key: string;
  kind: "pay" | "keep_open" | "no_inquiry" | "rescore" | "check";
  text: string;
};

export type GoalMonth = {
  // YYYY-MM.
  month: string;
  index: number;
  payCents: number;
  balanceAfterCents: number;
  projectedScore: number;
  items: GoalItem[];
};

export type GoalPlan = {
  months: GoalMonth[];
  // The score at the end of the plan, and whether it reaches the target.
  endScore: number;
  reaches: boolean;
  // The most any month reaches, when the target can't be (so the person knows).
  best: number;
  totalPayCents: number;
};

export function buildPlan(input: {
  asOf: string;
  kind: CreditGoalKind;
  targetScore: number;
  balanceCents: number;
  limitCents: number;
  months: number;
  cardNames: readonly string[];
  // The simulator's estimate for each balance left after a month's payment.
  scoreAfter: (balanceCents: number) => number;
  // What a new card's hard inquiry would cost, in points (the simulator's estimate).
  inquiryCostPoints: number;
}): GoalPlan {
  const balances = paydownBalances({
    balanceCents: input.balanceCents,
    limitCents: input.limitCents,
    months: input.months,
  });
  const months: GoalMonth[] = balances.map((balanceAfterCents, i) => {
    const before = i === 0 ? input.balanceCents : balances[i - 1];
    const payCents = Math.max(0, before - balanceAfterCents);
    const month = monthOf(addMonths(`${monthOf(input.asOf)}-01`, i));
    const items: GoalItem[] = [];
    if (payCents > 0) {
      items.push({
        key: "pay",
        kind: "pay",
        text: `Pay ${formatCents(payCents)} toward your cards before their statements close, so a lower balance is reported.`,
      });
    }
    items.push({
      key: "keep_open",
      kind: "keep_open",
      text: `Keep ${input.cardNames.length ? input.cardNames.join(", ") : "your card accounts"} open: closing one raises your card use and shortens your history.`,
    });
    items.push({
      key: "no_inquiry",
      kind: "no_inquiry",
      text: `Don't apply for new credit: a hard inquiry would cost about ${input.inquiryCostPoints} points.`,
    });
    items.push({ key: "on_time", kind: "check", text: "Make every payment on time." });
    const last = i === balances.length - 1;
    if (last && input.kind === "mortgage") {
      items.push({
        key: "rescore",
        kind: "rescore",
        text: `Before you apply, ask your lender for a rapid rescore. ${RAPID_RESCORE_NOTE}`,
      });
    }
    return {
      month,
      index: i + 1,
      payCents,
      balanceAfterCents,
      projectedScore: input.scoreAfter(balanceAfterCents),
      items,
    };
  });
  const endScore = months.at(-1)?.projectedScore ?? input.scoreAfter(input.balanceCents);
  return {
    months,
    endScore,
    reaches: endScore >= input.targetScore,
    best: Math.max(...months.map((m) => m.projectedScore), endScore),
    totalPayCents: months.reduce((s, m) => s + m.payCents, 0),
  };
}

export const goalTitle = (kind: CreditGoalKind, score: number, date: string) =>
  `A ${score} score for ${CREDIT_GOAL_LABELS[kind]} by ${dayLabel(date, { year: true })}`;
