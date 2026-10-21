// Investing decisions in the chat ("should I buy bitcoin?", "index funds or stocks?", "should I
// invest or pay off debt?"). Every one gets a direct answer of three sentences or fewer from the
// person's own numbers, in this order: high-interest debt, then the emergency fund, then money
// needed soon, then the kind of risk. Numbers here are rules of thumb, shown with their sources.
// FOR REVIEW.

// A balance at or above this rate costs more than investing can reliably earn.
export const HIGH_DEBT_APR_BPS = 800;
// Money needed within this many months doesn't belong in anything that can fall.
export const SOON_GOAL_MONTHS = 36;
// The most that a single company's stock is usually kept to, of everything invested.
export const SINGLE_STOCK_MAX_SHARE = 0.05;
export const SINGLE_STOCK_SOURCE = "A planners' rule of thumb for a single holding; FOR REVIEW";
// What broad index funds charge a year against the average actively managed stock fund, in
// basis points (Investment Company Institute, Trends in the Expenses and Fees of Funds).
export const INDEX_FEE_BPS = 5;
export const ACTIVE_FEE_BPS = 40;
// Retiring: the yearly share of savings a person can usually draw, and how much smaller Social
// Security is when taken at 62 against full retirement age at 67 (SSA).
export const SAFE_DRAW_SHARE = 0.04;
export const SAFE_DRAW_SOURCE = "The 4% rule of thumb from the Trinity study; FOR REVIEW";
export const SS_AT_62_CUT = 0.3;
export const MEDICARE_AGE = 65;
// Roth or traditional: from this federal rate up, traditional's deduction usually wins; at or
// below the low rate, Roth usually does.
export const ROTH_LOW_RATE = 0.12;
export const TRADITIONAL_HIGH_RATE = 0.24;
// Starting share of pay to invest, once the gates are clear.
export const START_SHARE = 0.05;

// The kinds of decision, with the words that ask them. Order matters: first match wins.
export const DECISION_KINDS = [
  "buy_crypto",
  "buy_stock",
  "index_vs_stocks",
  "invest_vs_debt",
  "save_vs_invest",
  "good_time",
  "sell",
  "start",
  "hsa",
  "roth_vs_traditional",
  "retire_at",
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

// Well-known companies a person might name; anything in capitals up to five letters counts as a
// ticker too.
export const KNOWN_COMPANIES: Readonly<Record<string, string>> = {
  tesla: "Tesla",
  apple: "Apple",
  nvidia: "Nvidia",
  amazon: "Amazon",
  google: "Google",
  alphabet: "Alphabet",
  microsoft: "Microsoft",
  meta: "Meta",
  netflix: "Netflix",
  disney: "Disney",
  gamestop: "GameStop",
  amc: "AMC",
  palantir: "Palantir",
  coinbase: "Coinbase",
};
