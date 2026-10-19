// What Jane knows about funds that Plaid doesn't say (spec step 128). Plaid Investments
// gives each security's name, ticker, type and price, but not what a fund costs a year or
// what it holds. Until a fund-data partner is connected, these facts come from this table,
// keyed by ticker: the demo bank's funds, which are made up (sample data, not real funds).
// A security with no entry has no expense ratio and is classed from its Plaid type.

// The broad kinds of investment Jane groups money into.
export const ASSET_CLASSES = {
  us_stocks: "US stocks",
  intl_stocks: "International stocks",
  bonds: "Bonds",
  cash: "Cash",
  other: "Other",
} as const;

export type AssetClass = keyof typeof ASSET_CLASSES;

// Shares of a fund in each asset class, summing to 1.
export type AssetMix = Partial<Record<AssetClass, number>>;

export type FundFacts = {
  // What the fund charges a year, as a share of the money in it, in basis points: 75 is
  // 0.75% a year.
  expenseRatioBps: number;
  mix: AssetMix;
  // What kind of fund it is, in plain words, e.g. "Target date 2055".
  category: string;
  // Where the facts came from.
  source: string;
};

const DEMO_SOURCE = "Demo fund facts (sample data, not a real fund)";

export const FUND_FACTS: Readonly<Record<string, FundFacts>> = {
  NSTDX: {
    expenseRatioBps: 75,
    mix: { us_stocks: 0.54, intl_stocks: 0.36, bonds: 0.1 },
    category: "Target date 2055",
    source: DEMO_SOURCE,
  },
  SLGFX: {
    expenseRatioBps: 102,
    mix: { us_stocks: 0.97, cash: 0.03 },
    category: "US large-company growth (actively managed)",
    source: DEMO_SOURCE,
  },
  KTSIX: {
    expenseRatioBps: 3,
    mix: { us_stocks: 1 },
    category: "US total stock market index",
    source: DEMO_SOURCE,
  },
  KTBIX: {
    expenseRatioBps: 5,
    mix: { bonds: 1 },
    category: "US total bond market index",
    source: DEMO_SOURCE,
  },
  KTIIX: {
    expenseRatioBps: 8,
    mix: { intl_stocks: 1 },
    category: "International total stock market index",
    source: DEMO_SOURCE,
  },
  DSVXX: {
    expenseRatioBps: 35,
    mix: { cash: 1 },
    category: "Stable value",
    source: DEMO_SOURCE,
  },
  KLCX: {
    expenseRatioBps: 4,
    mix: { us_stocks: 1 },
    category: "US large-company index",
    source: DEMO_SOURCE,
  },
  PDIFX: {
    expenseRatioBps: 115,
    mix: { us_stocks: 0.92, cash: 0.08 },
    category: "US dividend income (actively managed)",
    source: DEMO_SOURCE,
  },
  // Not held by the demo person: the lower-cost equivalents (spec step 130).
  KTRGX: {
    expenseRatioBps: 8,
    mix: { us_stocks: 0.54, intl_stocks: 0.36, bonds: 0.1 },
    category: "Target date 2055 (index)",
    source: DEMO_SOURCE,
  },
  KDVX: {
    expenseRatioBps: 6,
    mix: { us_stocks: 1 },
    category: "US dividend index",
    source: DEMO_SOURCE,
  },
};

// Names for funds Jane may suggest but nobody holds yet (held ones are named by Plaid).
export const FUND_NAMES: Readonly<Record<string, string>> = {
  NSTDX: "Northstar Target 2055 Fund",
  SLGFX: "Summit Large Cap Growth Fund",
  KTSIX: "Keystone Total US Stock Index Fund",
  KTBIX: "Keystone Total Bond Index Fund",
  KTIIX: "Keystone Total International Index Fund",
  DSVXX: "Demo Stable Value Fund",
  KLCX: "Keystone US Large Cap Index ETF",
  PDIFX: "Pinnacle Dividend Income Fund",
  KTRGX: "Keystone Target 2055 Index Fund",
  KDVX: "Keystone US Dividend Index ETF",
};

// Spec step 130: for a costly fund, funds that do a similar job for less, best first. In
// an employer plan (a 401(k) and the like) only funds on the plan's menu can be bought.
// Stand-in: a fund-data partner would supply both lists.
export const LOWER_COST_EQUIVALENTS: Readonly<Record<string, readonly string[]>> = {
  NSTDX: ["KTRGX"],
  SLGFX: ["KLCX", "KTSIX"],
  PDIFX: ["KDVX", "KLCX"],
};

// The funds the demo employer's 401(k) offers. Plaid doesn't report a plan's menu.
export const DEMO_EMPLOYER_PLAN_MENU: readonly string[] = [
  "NSTDX",
  "KTRGX",
  "SLGFX",
  "KTSIX",
  "KTIIX",
  "KTBIX",
  "DSVXX",
];

// Plaid subtypes of employer plans, where only the plan's menu can be bought.
export const EMPLOYER_PLAN_SUBTYPES: readonly string[] = [
  "401a",
  "401k",
  "403b",
  "457b",
  "roth 401k",
  "roth 403b",
  "roth 457b",
  "thrift savings plan",
  "profit sharing plan",
];

// A security Plaid describes but the table doesn't know: classed by its Plaid type.
export function mixOfType(type: string | null, isCashEquivalent: boolean): AssetMix {
  if (isCashEquivalent || type === "cash") return { cash: 1 };
  if (type === "equity") return { us_stocks: 1 };
  if (type === "fixed income") return { bonds: 1 };
  return { other: 1 };
}

// The investments page and Jane's answers: months of balances shown.
export const INVESTMENT_MONTHS = 12;

// Investment transactions read on each sync: two years on the first, then the last few
// weeks (Plaid can add or correct recent ones).
export const INVESTMENT_HISTORY_DAYS = 730;
export const INVESTMENT_RESYNC_DAYS = 30;
// Plaid returns at most this many investment transactions per call.
export const INVESTMENT_TRANSACTIONS_PAGE = 500;
