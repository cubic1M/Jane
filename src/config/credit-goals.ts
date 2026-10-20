// A credit score for a goal (spec step 227): the kinds of goal, how far ahead a plan can
// look, and what each month's checklist says. The score estimates come from the credit
// partner's simulator (step 175); nothing here changes a real account.

export const CREDIT_GOAL_KINDS = ["mortgage", "car", "other"] as const;
export type CreditGoalKind = (typeof CREDIT_GOAL_KINDS)[number];
export const CREDIT_GOAL_LABELS: Record<CreditGoalKind, string> = {
  mortgage: "a mortgage",
  car: "a car loan",
  other: "a loan",
};

export const GOAL_MIN_SCORE = 500;
export const GOAL_MAX_SCORE = 850;
export const GOAL_MIN_MONTHS = 1;
export const GOAL_MAX_MONTHS = 24;

// A rapid rescore: a lender asks the bureaus to update the report within days once
// balances have been paid down. Only a lender can ask; it's offered for a mortgage.
export const RAPID_RESCORE_NOTE =
  "A rapid rescore is when your lender asks the credit bureaus to update your report within a few days after you've paid balances down, so the new score is used for your application. Only a lender can ask; ask yours once your balances are paid.";
export const CREDIT_GOAL_SOURCE =
  "https://www.consumerfinance.gov/ask-cfpb/what-is-a-credit-score-en-315/";
