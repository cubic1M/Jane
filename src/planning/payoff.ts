import {
  BNPL_PAYMENTS_PER_MONTH,
  DEBT_EXTRA_SCENARIOS_CENTS,
  DEBT_PLAN_TRACK_MONTHS,
  PAYOFF_LEFT_OUT_KINDS,
  SNOWBALL_PICK_MAX_EXTRA_INTEREST_CENTS,
  SNOWBALL_QUICK_WIN_MONTHS,
} from "@/config/debt";
import type { Debt } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import { payoffOrder, payoffPlan, type DebtCard, type PayoffPlan, type Strategy } from "./debt";

// Payoff plans across every debt (spec step 110): the debt planner's own math
// (./debt.ts payoffPlan, so the numbers always match /debt), over every loan, card and
// buy now, pay later plan Jane knows about. Both orders, what paying only the minimums
// would cost, extra-payment scenarios, and, in demo advice mode only, which order Jane
// picks and why. Pure.

export type PlanDebt = DebtCard & { kind: Debt["kind"] };

// A debt the plan can't include yet, and why.
export type LeftOut = {
  name: string;
  reason: "mortgage" | "no_balance" | "no_rate" | "no_payment";
};

export function planDebts(debts: readonly Debt[]): { cards: PlanDebt[]; leftOut: LeftOut[] } {
  const cards: PlanDebt[] = [];
  const leftOut: LeftOut[] = [];
  for (const d of debts) {
    if (d.balanceCents !== null && d.balanceCents <= 0) continue;
    if (PAYOFF_LEFT_OUT_KINDS.includes(d.kind)) {
      leftOut.push({ name: d.name, reason: "mortgage" });
    } else if (d.balanceCents === null) {
      leftOut.push({ name: d.name, reason: "no_balance" });
    } else if (d.aprBps === null) {
      leftOut.push({ name: d.name, reason: "no_rate" });
    } else if (d.paymentCents === null) {
      leftOut.push({ name: d.name, reason: "no_payment" });
    } else {
      cards.push({
        id: d.key,
        name: d.name,
        kind: d.kind,
        balanceCents: d.balanceCents!,
        aprBps: d.aprBps,
        minimumCents:
          d.paymentEvery === "two_weeks"
            ? d.paymentCents * BNPL_PAYMENTS_PER_MONTH
            : d.paymentCents,
      });
    }
  }
  return { cards, leftOut };
}

export const minimumsOf = (cards: readonly DebtCard[]) =>
  cards.reduce((sum, c) => sum + c.minimumCents, 0);

// Paying only each debt's own minimum, with nothing rolled over when one is paid off: what
// the plan's interest is measured against. Each debt is its own one-debt plan.
export function minimumsOnly(cards: readonly DebtCard[]): PayoffPlan {
  const plans = cards.map((c) => payoffPlan([c], c.minimumCents, "avalanche"));
  const failed = plans.find((p) => !p.ok);
  if (failed && !failed.ok) return { ok: false, strategy: "avalanche", reason: failed.reason };
  const done = plans.filter((p): p is Extract<PayoffPlan, { ok: true }> => p.ok);
  return {
    ok: true,
    strategy: "avalanche",
    months: Math.max(0, ...done.map((p) => p.months)),
    totalInterestCents: done.reduce((sum, p) => sum + p.totalInterestCents, 0),
    totalPaidCents: done.reduce((sum, p) => sum + p.totalPaidCents, 0),
    paidOffMonth: Object.assign({}, ...done.map((p) => p.paidOffMonth)),
    schedule: [],
  };
}

export type Scenario = {
  extraCents: number;
  months: number;
  interestCents: number;
  // Against paying only the minimums; null when the minimums alone never pay it all off.
  interestSavedCents: number | null;
};

export type PayoffSummary = {
  cards: PlanDebt[];
  leftOut: LeftOut[];
  minimumsCents: number;
  extraCents: number;
  avalanche: PayoffPlan;
  snowball: PayoffPlan;
  baseline: PayoffPlan;
  // Demo advice only: the order Jane picks, the debts in that order and why, in at most
  // three lines. Null outside demo advice mode.
  pick: { strategy: Strategy; order: string[]; why: string[] } | null;
  // What paying more each month does, in the picked order (highest rate first without
  // advice), from DEBT_EXTRA_SCENARIOS_CENTS on top of the plan's own extra.
  scenarios: Scenario[];
};

type Ok = Extract<PayoffPlan, { ok: true }>;
const firstWin = (plan: Ok) => Math.min(...Object.values(plan.paidOffMonth));

export function pickStrategy(
  cards: readonly PlanDebt[],
  avalanche: PayoffPlan,
  snowball: PayoffPlan,
): { strategy: Strategy; why: string[] } {
  const top = payoffOrder([...cards], "avalanche")[0];
  if (!avalanche.ok || !snowball.ok || cards.length < 2) {
    return {
      strategy: "avalanche",
      why:
        cards.length < 2
          ? ["With one debt, the order doesn't matter: every extra dollar goes to it."]
          : [
              `Your ${top.name} has the highest rate (${formatRate(top.aprBps)}), so extra money saves the most there.`,
            ],
    };
  }
  const extraInterest = snowball.totalInterestCents - avalanche.totalInterestCents;
  const soonerBy = firstWin(avalanche) - firstWin(snowball);
  if (
    extraInterest <= SNOWBALL_PICK_MAX_EXTRA_INTEREST_CENTS &&
    soonerBy >= SNOWBALL_QUICK_WIN_MONTHS
  ) {
    const first = payoffOrder([...cards], "snowball")[0];
    return {
      strategy: "snowball",
      why: [
        `Smallest balance first clears your ${first.name} ${soonerBy} months sooner, so you see progress early.`,
        extraInterest > 0
          ? `It costs only ${formatCents(extraInterest)} more in interest than highest rate first.`
          : "It costs no more in interest than highest rate first.",
      ],
    };
  }
  return {
    strategy: "avalanche",
    why: [
      `Your ${top.name} has the highest rate (${formatRate(top.aprBps)}), so every extra dollar there saves the most interest.`,
      extraInterest > 0
        ? `That's ${formatCents(extraInterest)} less interest than paying the smallest balance first.`
        : "Here it costs the same as paying the smallest balance first.",
    ],
  };
}

export function payoffSummary(
  debts: readonly Debt[],
  { extraCents, advice }: { extraCents: number; advice: boolean },
): PayoffSummary {
  const { cards, leftOut } = planDebts(debts);
  const minimumsCents = minimumsOf(cards);
  const budget = minimumsCents + extraCents;
  const avalanche = payoffPlan(cards, budget, "avalanche");
  const snowball = payoffPlan(cards, budget, "snowball");
  const baseline = minimumsOnly(cards);
  const picked = advice && cards.length > 0 ? pickStrategy(cards, avalanche, snowball) : null;
  const strategy = picked?.strategy ?? "avalanche";
  const scenarios = DEBT_EXTRA_SCENARIOS_CENTS.flatMap((more): Scenario[] => {
    const plan = payoffPlan(cards, budget + more, strategy);
    if (!plan.ok) return [];
    return [
      {
        extraCents: extraCents + more,
        months: plan.months,
        interestCents: plan.totalInterestCents,
        interestSavedCents: baseline.ok
          ? baseline.totalInterestCents - plan.totalInterestCents
          : null,
      },
    ];
  });
  return {
    cards,
    leftOut,
    minimumsCents,
    extraCents,
    avalanche,
    snowball,
    baseline,
    pick: picked && {
      strategy: picked.strategy,
      order: payoffOrder(cards, picked.strategy).map((c) => c.name),
      why: picked.why,
    },
    scenarios,
  };
}

// What the plan's debts add up to now (first) and should add up to at the end of each of
// the next months, as the plan pays them down. For checking the plan each month.
export function expectedBalances(cards: readonly DebtCard[], plan: PayoffPlan): number[] {
  if (!plan.ok) return [];
  return [
    cards.reduce((sum, c) => sum + c.balanceCents, 0),
    ...plan.schedule
      .slice(0, DEBT_PLAN_TRACK_MONTHS)
      .map((m) => Object.values(m.balances).reduce((sum, b) => sum + b, 0)),
  ];
}

// "March 2028": the month `months` after `asOf`'s month.
export function monthAfter(asOf: string, months: number): string {
  const [y, m] = asOf.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7);
}

export const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
