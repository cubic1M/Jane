// Direct answers to the tax questions people really ask (taxes in the chat). Each is three
// sentences or fewer, from the person's own numbers. FOR REVIEW: the rule-of-thumb thresholds
// for choosing a traditional or Roth account are the brackets at which each usually wins.

export const DECISION_TOPICS = [
  "itemize",
  "roth_conversion",
  "withholding",
  "estimated",
  "k401",
  "ira",
  "hsa",
  "property",
  "harvest",
  "donate_stock",
  "home_office",
  "owe",
  "refund",
  "refund_why",
  "effective_rate",
  "paid",
  "deductions",
  "setaside",
  "est_due",
  "must_file",
  "mortgage_interest",
  "k401_limit",
] as const;
export type DecisionTopic = (typeof DECISION_TOPICS)[number];

// Topics whose answer is a recommendation, so it carries the demo advice label in advice mode.
export const ADVICE_DECISIONS: readonly DecisionTopic[] = [
  "itemize",
  "roth_conversion",
  "withholding",
  "estimated",
  "k401",
  "ira",
  "hsa",
  "property",
  "harvest",
  "donate_stock",
  "home_office",
];

// A traditional IRA or 401(k) tends to win at or above this top rate (the deduction is worth
// more than the tax-free growth later); a Roth tends to win at or below the lower one.
export const TRADITIONAL_FROM_RATE = 0.24;
export const ROTH_UNTIL_RATE = 0.12;

// Putting more into a 401(k), IRA or HSA is not the first move for someone who is overdrawn or
// carries debt at or above this yearly rate (basis points; mortgages and student loans are
// not counted): paying that debt down beats the tax saving, and a new payroll deferral
// shrinks the paycheck. ESTIMATE TO VERIFY: a judgment call, not a rule.
export const DEBT_FIRST_APR_BPS = 1500;
// Decisions that move money out of the paycheck or the bank into a tax-favoured account.
export const SAVING_DECISIONS: readonly DecisionTopic[] = ["k401", "ira", "hsa", "donate_stock"];
// ...and only when more than the cash on hand is carried on it (and at least this much), so a card paid off each month does not count.
export const DEBT_FIRST_MIN_CENTS = 100_000;
