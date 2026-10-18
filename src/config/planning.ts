// Debt payoff planner settings (src/planning/debt.ts).

// A plan that hasn't paid everything off after this many months is reported as never
// finishing: the payment barely covers the interest.
export const MAX_PAYOFF_MONTHS = 600;

// The most cards the planner takes at once.
export const MAX_PLANNER_CARDS = 10;
