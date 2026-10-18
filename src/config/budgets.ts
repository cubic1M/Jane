// Budgets (src/insights/budgets.ts).

// The suggested budget is the average of this many complete months of spending.
export const BUDGET_SUGGESTION_MONTHS = 3;
// Suggestions are rounded up to whole dollars of this size (in cents).
export const BUDGET_SUGGESTION_ROUNDING_CENTS = 1_000;
// The largest monthly budget accepted for one category (in cents), to catch typos.
export const MAX_BUDGET_CENTS = 10_000_000;
