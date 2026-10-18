import {
  CATEGORY_PROPOSAL_MIN_TRANSACTIONS,
  EMERGENCY_FUND_MONTHS,
  EMERGENCY_FUND_ROUNDING_CENTS,
  EMERGENCY_FUND_TARGET_MONTHS,
  PROPOSAL_BUDGET_COUNT,
  PROPOSAL_MIN_BUDGET_CENTS,
} from "@/config/proposals";
import { UNCATEGORIZED } from "@/insights/labels";

// What Jane proposes to set up, from the person's own numbers. Pure.

export type BudgetProposal = {
  kind: "budget";
  key: string;
  category: string;
  // The proposed monthly budget: their own average, rounded up.
  amountCents: number;
};

export type GoalProposal = {
  kind: "goal";
  key: string;
  name: string;
  targetCents: number;
  targetDate: string;
  // Their average monthly spending, the basis of the target.
  monthlySpendingCents: number;
};

export type CategoryProposal = {
  kind: "category";
  key: string;
  merchantKey: string;
  merchantName: string;
  // A Plaid detailed category, from the merchant directory.
  detailed: string;
  transactions: number;
};

export type Proposal = BudgetProposal | GoalProposal | CategoryProposal;

export type ProposalInput = {
  asOf: string;
  // Average monthly spending per category, rounded up (from budgetSummary).
  suggestions: Record<string, number>;
  budgetedCategories: string[];
  goalNames: string[];
  monthlySpendingCents: number;
  uncategorized: {
    merchantKey: string;
    merchantName: string;
    transactions: number;
    directoryCategory: string | null;
  }[];
};

function addMonths(asOf: string, months: number): string {
  const [y, m, d] = asOf.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, last));
  return date.toISOString().slice(0, 10);
}

export function proposals(input: ProposalInput): Proposal[] {
  const out: Proposal[] = [];
  const budgeted = new Set(input.budgetedCategories);
  Object.entries(input.suggestions)
    .filter(
      ([category, cents]) =>
        category !== UNCATEGORIZED && !budgeted.has(category) && cents >= PROPOSAL_MIN_BUDGET_CENTS,
    )
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, PROPOSAL_BUDGET_COUNT)
    .forEach(([category, amountCents]) =>
      out.push({ kind: "budget", key: `budget:${category}`, category, amountCents }),
    );

  if (input.monthlySpendingCents > 0 && !input.goalNames.some((n) => /emergency/i.test(n))) {
    const target =
      Math.ceil(
        (input.monthlySpendingCents * EMERGENCY_FUND_MONTHS) / EMERGENCY_FUND_ROUNDING_CENTS,
      ) * EMERGENCY_FUND_ROUNDING_CENTS;
    out.push({
      kind: "goal",
      key: "goal:emergency_fund",
      name: "Emergency fund",
      targetCents: target,
      targetDate: addMonths(input.asOf, EMERGENCY_FUND_TARGET_MONTHS),
      monthlySpendingCents: input.monthlySpendingCents,
    });
  }

  for (const m of input.uncategorized) {
    if (m.directoryCategory && m.transactions >= CATEGORY_PROPOSAL_MIN_TRANSACTIONS) {
      out.push({
        kind: "category",
        key: `category:${m.merchantKey}`,
        merchantKey: m.merchantKey,
        merchantName: m.merchantName,
        detailed: m.directoryCategory,
        transactions: m.transactions,
      });
    }
  }
  return out;
}
