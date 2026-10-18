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
