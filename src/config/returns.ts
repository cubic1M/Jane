// How investments have done (spec step 156): the periods Jane reports, and what counts as
// money in, money out and income in investment transactions (Plaid subtypes).

export const RETURN_PERIODS = [
  { key: "1m", label: "Last month", days: 30 },
  { key: "3m", label: "Last 3 months", days: 91 },
  { key: "1y", label: "Last 12 months", days: 365 },
] as const;

export type ReturnPeriodKey = (typeof RETURN_PERIODS)[number]["key"];

export const MONEY_IN_SUBTYPES: readonly string[] = ["contribution", "deposit", "transfer"];
export const MONEY_OUT_SUBTYPES: readonly string[] = ["withdrawal", "distribution"];
export const INCOME_SUBTYPES: readonly string[] = [
  "dividend",
  "qualified dividend",
  "non-qualified dividend",
  "interest",
  "dividend reinvestment",
  "interest reinvestment",
];

// Said under every return: they describe the past.
export const RETURNS_NOTE =
  "Past results, worked out from your balances; they don't say what comes next.";
