// Budgets (src/insights/budgets.ts).

// The suggested budget is the average of this many complete months of spending.
export const BUDGET_SUGGESTION_MONTHS = 3;
// Budgets are for spending you can change. Rent and utilities, loan payments, services (insurance,
// childcare, accounting), taxes and the like are fixed obligations, so Jane never suggests a
// budget for them (spec step 263). Plaid primary categories; a person can still set one by hand.
export const BUDGET_FIXED_PRIMARIES: readonly string[] = [
  "RENT_AND_UTILITIES",
  "LOAN_PAYMENTS",
  "LOAN_DISBURSEMENTS",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "BANK_FEES",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "INCOME",
];
// Suggestions are rounded up to whole dollars of this size (in cents).
export const BUDGET_SUGGESTION_ROUNDING_CENTS = 1_000;
// The largest monthly budget accepted for one category (in cents), to catch typos.
export const MAX_BUDGET_CENTS = 10_000_000;
