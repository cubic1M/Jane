import {
  ASSUMED_CURRENT_RATE_BPS,
  IDLE_CASH_HIGH_CONFIDENCE_MONTHS,
  IDLE_CASH_MEDIUM_CONFIDENCE_MONTHS,
  IDLE_CASH_MIN_EXCESS_CENTS,
  IDLE_CASH_MONTHS_OF_SPENDING,
  IDLE_CASH_SUBTYPES,
  NON_SPENDING_CATEGORIES,
  NON_SPENDING_PRIMARIES,
  REFERENCE_HIGH_YIELD_RATE_BPS,
  type ConfidenceLevel,
} from "@/config/detection";
import { formatCents } from "@/lib/money";
import { inList, inLookback } from "../helpers";
import type { DetectionInput } from "../types";
import { BASIS_POINTS, DAYS_PER_MONTH, daysBetween } from "../units";
import type { Rule } from "./rule";

// Average monthly spending, worked out per account over that account's own history (so a
// card with two months of data doesn't get spread over a year), then added up.
function monthlySpending(input: DetectionInput) {
  const spending = inLookback(input).filter(
    (t) =>
      t.amountCents > 0 &&
      !inList(t.pfcPrimary, NON_SPENDING_PRIMARIES) &&
      !inList(t.pfcDetailed, NON_SPENDING_CATEGORIES),
  );
  const accountIds = [...new Set(spending.map((t) => t.accountId))].sort();
  let monthlyCents = 0;
  let shortestHistoryMonths = Infinity;
  for (const accountId of accountIds) {
    const rows = spending.filter((t) => t.accountId === accountId);
    const earliest = rows.reduce((min, t) => (t.date < min ? t.date : min), input.asOf);
    const months = Math.max(1, daysBetween(earliest, input.asOf) / DAYS_PER_MONTH);
    monthlyCents += rows.reduce((sum, t) => sum + t.amountCents, 0) / months;
    shortestHistoryMonths = Math.min(shortestHistoryMonths, months);
  }
  return { monthlyCents: Math.round(monthlyCents), shortestHistoryMonths };
}

function confidenceFor(historyMonths: number): ConfidenceLevel {
  if (historyMonths >= IDLE_CASH_HIGH_CONFIDENCE_MONTHS) return "high";
  if (historyMonths >= IDLE_CASH_MEDIUM_CONFIDENCE_MONTHS) return "medium";
  return "low";
}

// Checking and savings balances above IDLE_CASH_MONTHS_OF_SPENDING months of spending.
// Savings are the excess times the gap between a reference high-yield rate and what we
// assume it earns now. Balances on CSV accounts are typed in by hand.
export const idleCash: Rule = (input) => {
  const accounts = input.accounts
    .filter(
      (a) =>
        a.type === "depository" &&
        inList(a.subtype, IDLE_CASH_SUBTYPES) &&
        a.currentBalanceCents !== null &&
        a.currentBalanceCents > 0,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const { monthlyCents, shortestHistoryMonths } = monthlySpending(input);
  if (accounts.length === 0 || monthlyCents <= 0) return [];

  const balance = accounts.reduce((sum, a) => sum + (a.currentBalanceCents ?? 0), 0);
  const cushion = monthlyCents * IDLE_CASH_MONTHS_OF_SPENDING;
  const excess = balance - cushion;
  if (excess < IDLE_CASH_MIN_EXCESS_CENTS) return [];

  const savings = Math.round(
    (excess * (REFERENCE_HIGH_YIELD_RATE_BPS - ASSUMED_CURRENT_RATE_BPS)) / BASIS_POINTS,
  );
  return [
    {
      type: "idle_cash",
      key: "depository",
      title: `${formatCents(excess)} more cash than ${IDLE_CASH_MONTHS_OF_SPENDING} months of spending`,
      annualSavingsCents: savings,
      amountCents: excess,
      confidence: confidenceFor(shortestHistoryMonths),
      evidence: {
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          balanceCents: a.currentBalanceCents,
        })),
        totalBalanceCents: balance,
        averageMonthlySpendingCents: monthlyCents,
        cushionCents: cushion,
        excessCents: excess,
        referenceRateBps: REFERENCE_HIGH_YIELD_RATE_BPS,
        assumedCurrentRateBps: ASSUMED_CURRENT_RATE_BPS,
      },
    },
  ];
};
