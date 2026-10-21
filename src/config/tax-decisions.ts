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
