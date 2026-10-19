// The assumptions behind every investment projection Jane shows (spec steps 130–137). Each
// projection is a range from LOW to HIGH, never one number and never a promise, and every
// page that shows one lists these with their sources (src/components/assumptions.tsx).

export type Assumption = { value: number; label: string; source: string };

// Yearly returns before fees and inflation, for a mix of stocks and bonds. Long-run US
// history is higher (stocks about 10% a year since 1926); the big fund companies' 10-year
// forecasts are lower than history. The range sits below history on purpose, so the high
// end isn't the past's best and the low end isn't a crash.
export const RETURN_LOW: Assumption = {
  value: 0.04,
  label: "Low yearly return",
  source: "In line with fund companies' 10-year forecasts, which are below history",
};
export const RETURN_HIGH: Assumption = {
  value: 0.07,
  label: "High yearly return",
  source: "Below long-run US history (stocks about 10% a year since 1926)",
};

// Prices rising, for amounts shown in today's dollars.
export const INFLATION: Assumption = {
  value: 0.025,
  label: "Inflation",
  source: "A little above the Federal Reserve's long-run goal of 2% a year",
};

export const ASSUMPTIONS = [RETURN_LOW, RETURN_HIGH, INFLATION] as const;

// The fee finder (spec step 130): how far ahead it looks, and when a fund counts as costly.
export const FEE_YEARS = 30;
// A fund charging more than this a year (in basis points: 40 is 0.40%) is checked for a
// lower-cost equivalent. Broad index funds charge about 0.02%–0.10%; the average stock
// mutual fund charges about 0.4% (Investment Company Institute, Trends in the Expenses and
// Fees of Funds).
export const HIGH_FEE_BPS = 40;
// An equivalent is only suggested when it saves at least this much a year.
export const MIN_FEE_SAVING_CENTS = 2_500;

// Investment transactions that are fees (Plaid subtypes), by kind.
export const ADVISORY_FEE_SUBTYPES: readonly string[] = ["management fee"];
export const ACCOUNT_FEE_SUBTYPES: readonly string[] = [
  "account fee",
  "fund fee",
  "transfer fee",
  "trust fee",
  "legal fee",
  "miscellaneous fee",
];
