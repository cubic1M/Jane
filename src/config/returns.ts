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

// Spec step 233: honest performance over one, three and five years, after fees and taxes,
// against a simple benchmark mix with the same risk. Only what happened: no forecasts.
export const HONEST_PERIODS = [
  { key: "1y", label: "1 year", days: 365 },
  { key: "3y", label: "3 years", days: 1096 },
  { key: "5y", label: "5 years", days: 1826 },
] as const;
export const BENCHMARK_SOURCE =
  "The person's target mix for their risk level (src/config/investing.ts TARGET_MIXES) held in the low-cost index funds in src/config/funds.ts (CORE_FUNDS), at those funds' own expense ratios";
// Where Jane doesn't know a fund's yield or taxes, the tax drag assumes no tax in
// tax-advantaged accounts and the person's rates on payouts in taxable ones.
export const HONEST_NOTE =
  "Returns before you linked your accounts use what you hold today at past prices. Fees and taxes are estimates from fund costs and payouts. This is what happened, not what will.";
