import { TUNE_UP_MIN_CENTS, TUNE_UP_MIN_SHARE } from "@/config/plan-upkeep";
import type { BudgetSummary } from "@/insights/budgets";

// A budget tune-up (spec step 101): each budget whose usual month (the average of the last
// few complete months, rounded up like the suggestions) moved away from it. Pure.

export type TuneUpChange = { category: string; fromCents: number; toCents: number };

export function tuneUpChanges(
  summary: Pick<BudgetSummary, "suggestions">,
  budgets: readonly { category: string; amountCents: number }[],
): TuneUpChange[] {
  return budgets
    .flatMap((b): TuneUpChange[] => {
      const usual = summary.suggestions[b.category];
      if (usual === undefined || usual <= 0) return [];
      const gap = Math.abs(usual - b.amountCents);
      if (gap < Math.max(b.amountCents * TUNE_UP_MIN_SHARE, TUNE_UP_MIN_CENTS)) return [];
      return [{ category: b.category, fromCents: b.amountCents, toCents: usual }];
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}
