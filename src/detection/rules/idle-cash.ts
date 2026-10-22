import {
  ASSUMED_CURRENT_RATE_BPS,
  IDLE_CASH_HIGH_CONFIDENCE_MONTHS,
  IDLE_CASH_MEDIUM_CONFIDENCE_MONTHS,
  IDLE_CASH_MONTHS_OF_SPENDING,
  REFERENCE_HIGH_YIELD_RATE_BPS,
  type ConfidenceLevel,
} from "@/config/detection";
import { idleCashOf } from "@/planning/idle-cash";
import { formatCents } from "@/lib/money";
import { inLookback } from "../helpers";
import type { DetectionInput } from "../types";
import type { Rule } from "./rule";

function confidenceFor(historyMonths: number): ConfidenceLevel {
  if (historyMonths >= IDLE_CASH_HIGH_CONFIDENCE_MONTHS) return "high";
  if (historyMonths >= IDLE_CASH_MEDIUM_CONFIDENCE_MONTHS) return "medium";
  return "low";
}

// Checking and savings balances above IDLE_CASH_MONTHS_OF_SPENDING months of spending.
// Savings are the excess times the gap between a reference high-yield rate and what we
// assume it earns now. Balances on CSV accounts are typed in by hand.
export const idleCash: Rule = (input) => {
  const idle = idleCashOf({
    asOf: input.asOf,
    accounts: input.accounts.map((a) => ({
      id: a.id,
      type: a.type,
      subtype: a.subtype,
      balanceCents: a.currentBalanceCents,
    })),
    transactions: inLookback(input).map((t) => ({
      date: t.date,
      amountCents: t.amountCents,
      accountId: t.accountId,
      pfc: t.pfcDetailed,
    })),
  });
  if (!idle) return [];
  const names = new Map(input.accounts.map((a) => [a.id, a]));
  return [
    {
      type: "idle_cash",
      key: "depository",
      title: `${formatCents(idle.excessCents)} more cash than ${IDLE_CASH_MONTHS_OF_SPENDING} months of spending`,
      annualSavingsCents: idle.earnsCents,
      amountCents: idle.excessCents,
      confidence: confidenceFor(idle.shortestHistoryMonths),
      evidence: {
        accounts: idle.accountIds.map((id) => ({
          id,
          name: names.get(id)?.name ?? null,
          balanceCents: names.get(id)?.currentBalanceCents ?? null,
        })),
        totalBalanceCents: idle.balanceCents,
        averageMonthlySpendingCents: idle.monthlyCents,
        cushionCents: idle.cushionCents,
        excessCents: idle.excessCents,
        referenceRateBps: REFERENCE_HIGH_YIELD_RATE_BPS,
        assumedCurrentRateBps: ASSUMED_CURRENT_RATE_BPS,
      },
    },
  ];
};
