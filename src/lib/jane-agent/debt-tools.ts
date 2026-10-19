import type Anthropic from "@anthropic-ai/sdk";
import { sourceLabel, type DebtBook } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import { MAX_DEBT_EXTRA_CENTS } from "@/config/debt";
import type { Payoff } from "@/lib/debt-plan";
import type { PayoffPlan } from "@/planning/debt";
import { monthAfter } from "@/planning/payoff";

// Claude's tools about debts in Jane's chat (spec Phase Y): read-only, over the same debt
// book as the loans page (src/lib/debts.ts). Every dollar figure goes through `money`, so
// the guardrails know it came from a tool (./claude-tools.ts).

const noInput = { type: "object" as const, properties: {}, additionalProperties: false };

export const DEBT_TOOLS: Anthropic.Tool[] = [
  {
    name: "debts",
    description:
      "Every debt the person has: loans and cards from their bank, buy now, pay later plans found from their payments, and terms they typed. For each: balance, rate (and where it came from: their bank, they typed it, the plan's terms, or not known), the regular payment, next due date, payoff date (and where it came from) and whether it's overdue. The loans and cards total is what net worth counts; buy now, pay later plans are on top.",
    input_schema: noInput,
  },
  {
    name: "payoff_plan",
    description:
      "A plan to pay off every debt except the mortgage, with the same math as the payoff planner: the minimums added up, debt-free month and total interest paying highest rate first and smallest balance first, what paying only the minimums would cost, what paying more each month does, debts left out and why, and the plan the person started (with whether it was on track at the last monthly check). In demo advice mode it also has Jane's pick of order and why. Give extra_dollars to see a different extra amount a month.",
    input_schema: {
      type: "object",
      properties: {
        extra_dollars: {
          type: "number",
          description: "Extra a month on top of the minimums, in dollars.",
        },
      },
      additionalProperties: false,
    },
  },
];

// The extra a month Claude asked about, in cents; undefined when it gave none or nonsense.
export function extraFromInput(input: unknown): number | undefined {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const dollars = value.extra_dollars;
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) return undefined;
  const cents = Math.round(dollars * 100);
  return cents >= 0 && cents <= MAX_DEBT_EXTRA_CENTS ? cents : undefined;
}

export function payoffToolOutput(payoff: Payoff, asOf: string, money: (cents: number) => string) {
  const { summary, stored } = payoff;
  const outcome = (plan: PayoffPlan) =>
    plan.ok
      ? {
          debtFree: monthAfter(asOf, plan.months),
          months: plan.months,
          interest: money(plan.totalInterestCents),
        }
      : { neverFinishes: plan.reason };
  return {
    debts: summary.cards.map((c) => ({
      name: c.name,
      balance: money(c.balanceCents),
      rate: formatRate(c.aprBps),
      monthlyPayment: money(c.minimumCents),
    })),
    leftOut: summary.leftOut,
    minimumsAMonth: money(summary.minimumsCents),
    extraAMonth: money(summary.extraCents),
    highestRateFirst: outcome(summary.avalanche),
    smallestBalanceFirst: outcome(summary.snowball),
    minimumsOnlyEachOnItsOwn: outcome(summary.baseline),
    payingMore: summary.scenarios.map((s) => ({
      extraAMonth: money(s.extraCents),
      debtFree: monthAfter(asOf, s.months),
      interest: money(s.interestCents),
      interestSavedVsMinimums: s.interestSavedCents === null ? null : money(s.interestSavedCents),
    })),
    janesPick: summary.pick,
    // What the two orders differ by in interest, so it can be quoted.
    interestDifference:
      summary.avalanche.ok && summary.snowball.ok
        ? money(
            Math.abs(summary.snowball.totalInterestCents - summary.avalanche.totalInterestCents),
          )
        : null,
    adviceMode: payoff.advice,
    startedPlan: stored && {
      order: stored.strategy === "avalanche" ? "highest rate first" : "smallest balance first",
      extraAMonth: money(stored.extraCents),
      debtFree: stored.debtFreeMonth,
      lastCheck: stored.status && {
        on: stored.checkedOn,
        status: stored.status,
        expected: stored.expectedCents === null ? null : money(stored.expectedCents),
        owed: stored.actualCents === null ? null : money(stored.actualCents),
      },
    },
  };
}

export function debtsToolOutput(book: DebtBook, money: (cents: number) => string) {
  return {
    loansAndCardsOwed: money(book.accountsOwedCents),
    buyNowPayLaterOwed: money(book.bnplOwedCents),
    buyNowPayLaterWithoutABalance: book.bnplUnknown,
    totalOwed: money(book.totalOwedCents),
    monthlyPayments: money(book.monthlyCents),
    debts: book.debts.map((d) => ({
      name: d.name,
      kind: d.kindLabel,
      balance: d.balanceCents === null ? null : money(d.balanceCents),
      rate: d.aprBps === null ? null : formatRate(d.aprBps),
      rateType: d.rateType,
      rateFrom: sourceLabel(d.aprFrom, d.typedOn),
      payment: d.paymentCents === null ? null : money(d.paymentCents),
      paymentEvery: d.paymentEvery === "month" ? "month" : "two weeks",
      nextDue: d.nextDue,
      payoffDate: d.payoffDate,
      payoffFrom: d.payoffDate ? sourceLabel(d.payoffFrom, d.typedOn) : null,
      overdue: d.overdue,
      pastDue: d.pastDueCents ? money(d.pastDueCents) : null,
      inNetWorth: d.inNetWorth,
    })),
    missingRates: book.missingRate.map((d) => d.name),
  };
}
