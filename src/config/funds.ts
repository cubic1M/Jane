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
  // Spec step 135: what it pays out a year (interest and dividends) as a share of its
  // value, in basis points, and whether that's mostly interest (taxed as ordinary income)
  // rather than qualified dividends.
  yieldBps?: number;
  interest?: boolean;
};

const DEMO_SOURCE = "Demo fund facts (sample data, not a real fund)";

export const FUND_FACTS: Readonly<Record<string, FundFacts>> = {
  NSTDX: {
    expenseRatioBps: 75,
    mix: { us_stocks: 0.54, intl_stocks: 0.36, bonds: 0.1 },
    category: "Target date 2055",
    source: DEMO_SOURCE,
    yieldBps: 170,
  },
  SLGFX: {
    expenseRatioBps: 102,
    mix: { us_stocks: 0.97, cash: 0.03 },
    category: "US large-company growth (actively managed)",
    source: DEMO_SOURCE,
    yieldBps: 40,
  },
  KTSIX: {
    expenseRatioBps: 3,
    mix: { us_stocks: 1 },
    category: "US total stock market index",
    source: DEMO_SOURCE,
    yieldBps: 130,
  },
  KTBIX: {
    expenseRatioBps: 5,
    mix: { bonds: 1 },
    category: "US total bond market index",
    source: DEMO_SOURCE,
    yieldBps: 380,
    interest: true,
  },
  KTIIX: {
    expenseRatioBps: 8,
    mix: { intl_stocks: 1 },
    category: "International total stock market index",
    source: DEMO_SOURCE,
    yieldBps: 290,
  },
  DSVXX: {
    expenseRatioBps: 35,
    mix: { cash: 1 },
    category: "Stable value",
    source: DEMO_SOURCE,
    yieldBps: 310,
    interest: true,
  },
  // Spec step 162: the demo brokerage's money market fund, for cash beyond the emergency fund.
  KMMXX: {
    expenseRatioBps: 11,
    mix: { cash: 1 },
    category: "Money market",
    source: DEMO_SOURCE,
    yieldBps: 420,
    interest: true,
  },
  KLCX: {
    expenseRatioBps: 4,
    mix: { us_stocks: 1 },
    category: "US large-company index",
    source: DEMO_SOURCE,
    yieldBps: 120,
  },
  PDIFX: {
    expenseRatioBps: 115,
    mix: { us_stocks: 0.92, cash: 0.08 },
    category: "US dividend income (actively managed)",
    source: DEMO_SOURCE,
    yieldBps: 320,
  },
  // Not held by the demo person: the lower-cost equivalents (spec step 130).
  KTRGX: {
    expenseRatioBps: 8,
    mix: { us_stocks: 0.54, intl_stocks: 0.36, bonds: 0.1 },
    category: "Target date 2055 (index)",
    source: DEMO_SOURCE,
    yieldBps: 180,
  },
  KDVX: {
    expenseRatioBps: 6,
    mix: { us_stocks: 1 },
    category: "US dividend index",
    source: DEMO_SOURCE,
    yieldBps: 280,
  },
  // Spec step 236: screened stand-in funds (tags in src/config/values.ts).
  KUFFX: {
    expenseRatioBps: 5,
    mix: { us_stocks: 1 },
    category: "US total stock market index, fossil-fuel free",
    source: DEMO_SOURCE,
    yieldBps: 125,
  },
  KUSEX: {
    expenseRatioBps: 9,
    mix: { us_stocks: 1 },
    category: "US total stock market index, screened (fossil fuels, weapons, tobacco)",
    source: DEMO_SOURCE,
    yieldBps: 120,
  },
  KUCEX: {
    expenseRatioBps: 22,
    mix: { us_stocks: 1 },
    category: "US clean-energy tilt, screened",
    source: DEMO_SOURCE,
    yieldBps: 60,
  },
  KISEX: {
    expenseRatioBps: 16,
    mix: { intl_stocks: 1 },
    category: "International stock index, screened (fossil fuels, weapons, tobacco)",
    source: DEMO_SOURCE,
    yieldBps: 270,
  },
  KBSEX: {
    expenseRatioBps: 11,
    mix: { bonds: 1 },
    category: "US bond index, screened (fossil fuels, weapons, tobacco)",
    source: DEMO_SOURCE,
    yieldBps: 370,
    interest: true,
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
  KMMXX: "Keystone Money Market Fund",
  KLCX: "Keystone US Large Cap Index ETF",
  PDIFX: "Pinnacle Dividend Income Fund",
  KTRGX: "Keystone Target 2055 Index Fund",
  KDVX: "Keystone US Dividend Index ETF",
  KUFFX: "Keystone US Fossil-Free Index Fund",
  KUSEX: "Keystone US Screened Index Fund",
  KUCEX: "Keystone US Clean Energy Tilt Fund",
  KISEX: "Keystone International Screened Index Fund",
  KBSEX: "Keystone Screened Bond Index Fund",
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

// Spec step 131: the low-cost index fund Jane uses for each kind of investment when it
// moves money to the target mix (and step 133 turns into orders). All are on the demo
// plan's menu, so they work in the 401(k) too. Stand-in, like the rest of this table.
export const CORE_FUNDS: Readonly<Record<Exclude<AssetClass, "other">, string>> = {
  us_stocks: "KTSIX",
  intl_stocks: "KTIIX",
  bonds: "KTBIX",
  cash: "DSVXX",
};

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

// What a fund Jane may buy holds, by ticker (spec step 133).
export const mixOfTicker = (ticker: string): AssetMix =>
  FUND_FACTS[ticker.toUpperCase()]?.mix ?? { other: 1 };

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
