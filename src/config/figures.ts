// Every figure explained, and correctable (spec step 239): the headline figures that open
// their working, how each is asked for in the chat, and what the person can correct on it.

export const FIGURE_IDS = [
  "safe_to_spend",
  "monthly_spending",
  "monthly_income",
  "net_worth",
  "health_score",
  "debt_free",
] as const;
export type FigureId = (typeof FIGURE_IDS)[number];

export const FIGURE_LABELS: Record<FigureId, string> = {
  safe_to_spend: "Safe to spend",
  monthly_spending: "Monthly spending",
  monthly_income: "Monthly income",
  net_worth: "Net worth",
  health_score: "Money health score",
  debt_free: "Debt-free date",
};

// How each is named in "how did you get my …?".
export const FIGURE_WORDS: Record<FigureId, RegExp> = {
  safe_to_spend: /\bsafe to spend\b|\bspending money\b|\bleft to spend\b/,
  monthly_spending: /\b(?:monthly )?spending\b|\bhow much i spend\b/,
  monthly_income: /\b(?:monthly )?income\b|\bhow much i (?:earn|make)\b|\bpay\b/,
  net_worth: /\bnet worth\b/,
  health_score: /\bhealth score\b|\bmoney health\b/,
  debt_free: /\bdebt[- ]free\b|\bpaid off\b/,
};

// What can be corrected on each: a transaction's category, or the income.
export const FIGURE_CORRECTIONS: Record<FigureId, readonly ("category" | "income")[]> = {
  safe_to_spend: [],
  monthly_spending: ["category"],
  monthly_income: ["category", "income"],
  net_worth: [],
  health_score: ["income"],
  debt_free: [],
};

// Transactions shown in a working, at most.
export const WORKING_TRANSACTIONS = 10;
