// Debt payoff planner settings (src/planning/debt.ts).

// A plan that hasn't paid everything off after this many months is reported as never
// finishing: the payment barely covers the interest.
export const MAX_PAYOFF_MONTHS = 600;

// The most cards and loans the planner takes at once.
export const MAX_PLANNER_CARDS = 10;

// Loans the planner leaves out (Plaid subtypes): a mortgage runs for decades and would
// swamp the comparison. Student, car and other loans are included (spec step 65).
export const PLANNER_LEFT_OUT_SUBTYPES: readonly string[] = ["mortgage"];
