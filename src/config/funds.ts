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
  // The day the expense ratio was read from the fund's own filing (its prospectus fee table, Form
  // N-1A, or summary prospectus), when it has been. Without it the figure is the fund company's
  // published one, rounded, and not yet checked against the filing.
  asOf?: string;
};

const DEMO_SOURCE = "Demo fund facts (sample data, not a real fund)";

// Spec: the investing area for the read-only beta. Expense ratios the fund companies publish for
// well-known real funds, rounded, for facts on real accounts (what the funds cost in dollars a
// year). They change a little each year: every figure shows where it came from and says to
// confirm it on the fund's own page. A fund missing here shows "not known", never a guess.
const REAL_SOURCE =
  "Fund company's published expense ratio, rounded; the fee table in its prospectus (SEC Form N-1A) is the check";
const real = (expenseRatioBps: number, mix: AssetMix, category: string): FundFacts => ({
  expenseRatioBps,
  mix,
  category,
  source: REAL_SOURCE,
});
// A figure read from the fund's own latest filing (SEC risk/return summary data, the fee table of
// its prospectus): the filing's date is the asOf and its folder on sec.gov the source. It wins over
// the fund company's published figure. Net of any fee waiver when the filing gives a net figure.
const sec = (
  expenseRatioBps: number,
  mix: AssetMix,
  category: string,
  filed: string,
  filing: { cik: number; adsh: string; form: string },
): FundFacts => ({
  expenseRatioBps,
  mix,
  category,
  asOf: `${filed.slice(0, 4)}-${filed.slice(4, 6)}-${filed.slice(6, 8)}`,
  source: `SEC ${filing.form} filed ${filed.slice(0, 4)}-${filed.slice(4, 6)}-${filed.slice(6, 8)}, fee table: https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.adsh.replaceAll("-", "")}/`,
});
const US = { us_stocks: 1 } as const;
const INTL = { intl_stocks: 1 } as const;
const BONDS = { bonds: 1 } as const;

export const REAL_FUND_FACTS: Readonly<Record<string, FundFacts>> = {
  VTI: sec(3, US, "US total stock market ETF", "20260428", {
    cik: 36405,
    adsh: "0000036405-26-000181",
    form: "485BPOS",
  }),
  VOO: sec(3, US, "S&P 500 ETF", "20260428", {
    cik: 36405,
    adsh: "0000036405-26-000181",
    form: "485BPOS",
  }),
  IVV: real(3, US, "S&P 500 ETF"),
  SPY: real(9, US, "S&P 500 ETF"),
  QQQ: sec(18, US, "Nasdaq-100 ETF", "20251219", {
    cik: 1067839,
    adsh: "0001104659-25-123273",
    form: "485BPOS",
  }),
  VUG: sec(3, US, "US large-company growth ETF", "20260428", {
    cik: 36405,
    adsh: "0000036405-26-000181",
    form: "485BPOS",
  }),
  VTV: sec(3, US, "US large-company value ETF", "20260428", {
    cik: 36405,
    adsh: "0000036405-26-000181",
    form: "485BPOS",
  }),
  SCHB: sec(3, US, "US broad market ETF", "20251222", {
    cik: 1454889,
    adsh: "0001104659-25-123308",
    form: "485BPOS",
  }),
  SCHX: sec(3, US, "US large-company ETF", "20251222", {
    cik: 1454889,
    adsh: "0001104659-25-123308",
    form: "485BPOS",
  }),
  SCHD: sec(6, US, "US dividend ETF", "20251222", {
    cik: 1454889,
    adsh: "0001104659-25-123308",
    form: "485BPOS",
  }),
  VTSAX: sec(4, US, "US total stock market index fund", "20260428", {
    cik: 36405,
    adsh: "0000036405-26-000181",
    form: "485BPOS",
  }),
  VFIAX: sec(4, US, "S&P 500 index fund", "20260428", {
    cik: 36405,
    adsh: "0000036405-26-000181",
    form: "485BPOS",
  }),
  FXAIX: sec(1, US, "S&P 500 index fund", "20260424", {
    cik: 819118,
    adsh: "0000819118-26-000072",
    form: "485BPOS",
  }),
  FSKAX: sec(1, US, "US total stock market index fund", "20260424", {
    cik: 819118,
    adsh: "0000819118-26-000072",
    form: "485BPOS",
  }),
  SWTSX: sec(3, US, "US total stock market index fund", "20260226", {
    cik: 904333,
    adsh: "0000884546-26-000041",
    form: "485BPOS",
  }),
  SWPPX: sec(2, US, "S&P 500 index fund", "20260226", {
    cik: 904333,
    adsh: "0000884546-26-000041",
    form: "485BPOS",
  }),
  FCNTX: sec(74, US, "US large-company growth fund (actively managed)", "20260224", {
    cik: 24238,
    adsh: "0000024238-26-000028",
    form: "485BPOS",
  }),
  ARKK: sec(75, US, "Actively managed innovation ETF", "20251126", {
    cik: 1579982,
    adsh: "0001213900-25-115285",
    form: "485BPOS",
  }),
  SPXL: real(91, US, "Leveraged S&P 500 ETF (3x daily)"),
  TQQQ: real(84, US, "Leveraged Nasdaq-100 ETF (3x daily)"),
  VXUS: sec(5, INTL, "International total stock market ETF", "20260227", {
    cik: 736054,
    adsh: "0001193125-26-077488",
    form: "485BPOS",
  }),
  VEA: sec(3, INTL, "Developed-markets ETF", "20260428", {
    cik: 923202,
    adsh: "0000923202-26-000059",
    form: "485BPOS",
  }),
  VWO: sec(6, INTL, "Emerging-markets ETF", "20260227", {
    cik: 857489,
    adsh: "0001193125-26-077485",
    form: "485BPOS",
  }),
  IEFA: sec(7, INTL, "Developed-markets ETF", "20251121", {
    cik: 1100663,
    adsh: "0001193125-25-291438",
    form: "485BPOS",
  }),
  IEMG: sec(9, INTL, "Emerging-markets ETF", "20251219", {
    cik: 930667,
    adsh: "0001193125-25-327007",
    form: "485BPOS",
  }),
  SCHF: sec(3, INTL, "International large-company ETF", "20251222", {
    cik: 1454889,
    adsh: "0001104659-25-123308",
    form: "485BPOS",
  }),
  VTIAX: sec(9, INTL, "International total stock market index fund", "20260227", {
    cik: 736054,
    adsh: "0001193125-26-077488",
    form: "485BPOS",
  }),
  FTIHX: sec(6, INTL, "International total stock market index fund", "20251229", {
    cik: 35315,
    adsh: "0000035315-25-001299",
    form: "485BPOS",
  }),
  VT: sec(6, { us_stocks: 0.6, intl_stocks: 0.4 }, "Total world stock ETF", "20260227", {
    cik: 857489,
    adsh: "0001193125-26-077485",
    form: "485BPOS",
  }),
  BND: sec(3, BONDS, "US total bond market ETF", "20260428", {
    cik: 794105,
    adsh: "0000794105-26-000106",
    form: "485BPOS",
  }),
  AGG: sec(3, BONDS, "US total bond market ETF", "20260618", {
    cik: 1100663,
    adsh: "0001193125-26-275730",
    form: "485BPOS",
  }),
  VBTLX: sec(4, BONDS, "US total bond market index fund", "20260428", {
    cik: 794105,
    adsh: "0000794105-26-000106",
    form: "485BPOS",
  }),
  FXNAX: sec(3, BONDS, "US total bond market index fund", "20251027", {
    cik: 35315,
    adsh: "0000035315-25-001071",
    form: "485BPOS",
  }),
  VNQ: sec(13, { other: 1 }, "Real estate ETF", "20260528", {
    cik: 734383,
    adsh: "0000734383-26-000129",
    form: "485BPOS",
  }),
  GLD: real(40, { other: 1 }, "Gold ETF"),
  IBIT: real(25, { other: 1 }, "Bitcoin ETF"),
};

const DEMO_FUND_FACTS: Readonly<Record<string, FundFacts>> = {
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

// Demo funds and the well-known real ones, by ticker.
export const FUND_FACTS: Readonly<Record<string, FundFacts>> = {
  ...REAL_FUND_FACTS,
  ...DEMO_FUND_FACTS,
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
  // Real funds: the same job at a lower published cost (S&P 500, developed-markets and
  // international-total-market funds); FOR REVIEW with the fund company's own page.
  FCNTX: ["FXAIX", "VOO"],
  SPY: ["VOO", "IVV"],
  VTIAX: ["VXUS"],
  IEFA: ["VEA", "SCHF"],
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
