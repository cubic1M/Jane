// Set-up Jane proposes from the person's own numbers (spec step 55). Proposals are math
// from their data, labelled as such, never advice.

// Budgets proposed at most for this many of the biggest spending categories without one...
export const PROPOSAL_BUDGET_COUNT = 3;
// ...and only where the monthly average is at least this much (in cents).
export const PROPOSAL_MIN_BUDGET_CENTS = 2_000;

// An emergency fund of this many months of the person's own average spending...
export const EMERGENCY_FUND_MONTHS = 3;
// ...to reach this many months from now...
export const EMERGENCY_FUND_TARGET_MONTHS = 12;
// ...rounded up to whole dollars of this size (in cents).
export const EMERGENCY_FUND_ROUNDING_CENTS = 10_000;

// A merchant with no category gets one proposed (from the merchant directory) once it has
// at least this many charges.
export const CATEGORY_PROPOSAL_MIN_TRANSACTIONS = 2;

// How big the emergency fund should be depends on the person (spec step 263, from the QA sweep):
// - income that moves around (freelance, a business): this many months of spending;
export const EMERGENCY_FUND_MONTHS_UNEVEN = 6;
// - someone in debt trouble: a small starter buffer before the debt plan, not months of spending,
//   reached in this many months;
export const EMERGENCY_STARTER_CENTS = 100_000;
export const EMERGENCY_STARTER_TARGET_MONTHS = 6;
// - a retiree on a pension: this many months of the gap between spending and income, and nothing
//   when income covers spending.
export const EMERGENCY_FUND_GAP_MONTHS = 12;
