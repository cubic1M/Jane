import { HIGH_YIELD_SAVINGS_BPS, CASH_RATES_AS_OF, CURRENT_CASH_RATE_BPS } from "@/config/cash";
import { STUDENT_PLANS } from "@/config/life-facts";
import { PRODUCTS, SHORT_TERM_RATES_AS_OF } from "@/config/short-term";

// Jane's offers catalog (src/lib/offers/): where each market figure comes from, how often it's read,
// how long a reading may be shown, and what a believable reading looks like. Sources, best first:
// official free APIs (Treasury, FRED), then the provider's own public page, read gently (robots.txt
// respected, an honest user agent, one request per source per run). Never an aggregator (NerdWallet,
// Bankrate and the like): their terms forbid it.

// Who Jane says it is when it reads a page.
export const OFFERS_USER_AGENT = "JaneBot/1.0 (+https://jane-dusky.vercel.app; offers catalog)";
export const OFFERS_FETCH_TIMEOUT_MS = 15_000;
// A page longer than this is cut, for the parser and for Claude.
export const OFFERS_MAX_PAGE_CHARS = 2_000_000;
// One run of the refresher (the hourly call, the daily backstop) spends at most this long.
export const OFFERS_RUN_BUDGET_MS = 60_000;
// A person's own charge just changed: a plan price older than this is read again first.
export const OFFERS_RECHECK_HOURS = 6;
// How long robots.txt is believed.
export const OFFERS_ROBOTS_HOURS = 24;

// The Claude fallback, when a page's parser breaks: off unless OFFERS_CLAUDE_MODEL (the cheapest
// model, e.g. claude-haiku-5-5) and ANTHROPIC_API_KEY are set. Only when the page's fingerprint
// changed since it was last read, and at most this many calls in a calendar month (UTC).
export const OFFERS_CLAUDE_MONTHLY_CALLS = 40;
// What Claude is shown of a page, in characters of text.
export const OFFERS_CLAUDE_PAGE_CHARS = 24_000;
export const OFFERS_CLAUDE_MAX_TOKENS = 300;

export type OfferKind =
  "savings_apy" | "tbill_yield" | "national_rate" | "benchmark_rate" | "plan_price";

export type OfferSpec = {
  key: string;
  kind: OfferKind;
  provider: string;
  name: string;
  // A believable reading, in basis points (rates) or cents a month (prices).
  plausible: readonly [number, number];
  // The most a reading may move from the last live one before it's quarantined for a person to
  // check, in the same unit.
  maxJump: number;
  merchantKey?: string;
  signUpUrl?: string;
  minimumBalanceCents?: number;
};

export type SourceSpec = {
  key: string;
  // api: an official API's JSON; page: the provider's own page, read by a parser.
  how: "api" | "page";
  url: string;
  // Shown beside the figure ("checked 9:00am from fdic.gov").
  sourceUrl: string;
  everyMinutes: number;
  // How long a reading may be shown after it was checked.
  showHours: number;
  // An env var the source needs (an API key); without it the source is skipped.
  needsEnv?: string;
  offers: readonly OfferSpec[];
};

const HOUR = 60;
const DAY = 24 * HOUR;

export const OFFER_SOURCES: readonly SourceSpec[] = [
  {
    key: "treasury.bills",
    how: "api",
    // Treasury's own auction results (fiscaldata.treasury.gov, free, no key).
    url: "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query?filter=security_type:eq:Bill&sort=-auction_date&page[size]=40&fields=auction_date,security_term,high_investment_rate",
    sourceUrl: "https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/",
    everyMinutes: 4 * HOUR,
    showHours: 10 * 24,
    offers: [
      ["4w", "4-Week"],
      ["13w", "13-Week"],
      ["26w", "26-Week"],
      ["52w", "52-Week"],
    ].map(([key, term]) => ({
      key: `tbill.${key}`,
      kind: "tbill_yield" as const,
      provider: "U.S. Treasury",
      name: `${term} Treasury bill`,
      plausible: [0, 1_200] as const,
      maxJump: 150,
      signUpUrl: "https://www.treasurydirect.gov/",
    })),
  },
  {
    key: "fdic.national",
    how: "page",
    // The FDIC's national deposit rates, posted the third Monday of each month.
    url: "https://www.fdic.gov/national-rates-and-rate-caps",
    sourceUrl: "https://www.fdic.gov/national-rates-and-rate-caps",
    everyMinutes: 12 * HOUR,
    showHours: 45 * 24,
    offers: [
      ["savings", "Savings"],
      ["checking", "Interest checking"],
      ["money_market", "Money market"],
      ["cd_12m", "12-month CD"],
    ].map(([key, name]) => ({
      key: `fdic.${key}`,
      kind: "national_rate" as const,
      provider: "FDIC national average",
      name: name as string,
      plausible: [0, 800] as const,
      maxJump: 100,
    })),
  },
  {
    key: "fred.rates",
    how: "api",
    // FRED's API (St. Louis Fed); needs a free key the founders make at fred.stlouisfed.org.
    url: "https://api.stlouisfed.org/fred/series/observations",
    sourceUrl: "https://fred.stlouisfed.org/",
    everyMinutes: DAY,
    showHours: 21 * 24,
    needsEnv: "FRED_API_KEY",
    offers: [
      {
        key: "fred.MORTGAGE30US",
        name: "30-year fixed mortgage average",
        provider: "Freddie Mac via FRED",
      },
      {
        key: "fred.TERMCBPER24NS",
        name: "24-month personal loan average",
        provider: "Federal Reserve via FRED",
      },
      {
        key: "fred.RIFLPBCIANM60NM",
        name: "60-month new car loan average",
        provider: "Federal Reserve via FRED",
      },
    ].map((o) => ({
      ...o,
      kind: "benchmark_rate" as const,
      plausible: [100, 3_000] as const,
      maxJump: 150,
    })),
  },
  {
    key: "barclays.savings",
    how: "page",
    url: "https://banking.barclaysus.com/online-savings.html",
    sourceUrl: "https://banking.barclaysus.com/online-savings.html",
    everyMinutes: 6 * HOUR,
    showHours: 3 * 24,
    offers: [
      {
        key: "savings.barclays",
        kind: "savings_apy",
        provider: "Barclays",
        name: "Barclays Online Savings",
        plausible: [50, 800],
        maxJump: 100,
        signUpUrl: "https://banking.barclaysus.com/online-savings.html",
      },
    ],
  },
  {
    key: "cit.platinum",
    how: "page",
    url: "https://www.cit.com/cit-bank/platinum-savings",
    sourceUrl: "https://www.cit.com/cit-bank/platinum-savings",
    everyMinutes: 6 * HOUR,
    showHours: 3 * 24,
    offers: [
      {
        key: "savings.cit_platinum",
        kind: "savings_apy",
        provider: "CIT Bank",
        name: "CIT Platinum Savings",
        plausible: [50, 800],
        maxJump: 100,
        signUpUrl: "https://www.cit.com/cit-bank/platinum-savings",
        // Its top rate is on balances of $5,000 or more.
        minimumBalanceCents: 500_000,
      },
    ],
  },
  {
    key: "spotify.plans",
    how: "page",
    url: "https://www.spotify.com/us/premium/",
    sourceUrl: "https://www.spotify.com/us/premium/",
    everyMinutes: DAY,
    showHours: 7 * 24,
    offers: planPair("spotify", "Spotify", "Spotify Premium"),
  },
  {
    key: "apple.music",
    how: "page",
    url: "https://www.apple.com/apple-music/",
    sourceUrl: "https://www.apple.com/apple-music/",
    everyMinutes: DAY,
    showHours: 7 * 24,
    offers: planPair("apple_music", "Apple", "Apple Music"),
  },
];

// A service's usual plan and its student plan, as two rows.
function planPair(merchantKey: string, provider: string, name: string): OfferSpec[] {
  return [
    {
      key: `plan.${merchantKey}.individual`,
      kind: "plan_price",
      provider,
      name: `${name} Individual`,
      plausible: [100, 5_000],
      maxJump: 500,
      merchantKey,
    },
    {
      key: `plan.${merchantKey}.student`,
      kind: "plan_price",
      provider,
      name: `${name} Student`,
      plausible: [0, 3_000],
      maxJump: 500,
      merchantKey,
    },
  ];
}

// The figures Jane kept by hand before the catalog, as its first rows (checked when they were
// written, src/config/cash.ts, short-term.ts and life-facts.ts). Each is shown only until its
// source's showHours run out, so a reader that never worked can't keep an old figure alive.
export const OFFER_SEEDS: readonly {
  key: string;
  source: string;
  kind: OfferKind;
  provider: string;
  name: string;
  valueBps?: number;
  valueCents?: number;
  merchantKey?: string;
  sourceUrl: string;
  checkedOn: string;
}[] = [
  ...(["13w", "26w", "52w"] as const).map((term) => ({
    key: `tbill.${term}`,
    source: "treasury.bills",
    kind: "tbill_yield" as const,
    provider: "U.S. Treasury",
    name: `${term.replace("w", "")}-Week Treasury bill`,
    valueBps: PRODUCTS.find(
      (p) => p.key === { "13w": "tbill_3", "26w": "tbill_6", "52w": "tbill_12" }[term],
    )?.rateBps,
    sourceUrl: "https://www.treasurydirect.gov/",
    checkedOn: SHORT_TERM_RATES_AS_OF,
  })),
  {
    key: "fdic.savings",
    source: "fdic.national",
    kind: "national_rate",
    provider: "FDIC national average",
    name: "Savings",
    valueBps: CURRENT_CASH_RATE_BPS.savings,
    sourceUrl: "https://www.fdic.gov/national-rates-and-rate-caps",
    checkedOn: CASH_RATES_AS_OF,
  },
  {
    key: "fdic.checking",
    source: "fdic.national",
    kind: "national_rate",
    provider: "FDIC national average",
    name: "Interest checking",
    valueBps: CURRENT_CASH_RATE_BPS.checking,
    sourceUrl: "https://www.fdic.gov/national-rates-and-rate-caps",
    checkedOn: CASH_RATES_AS_OF,
  },
  {
    key: "savings.reference",
    source: "seed",
    kind: "savings_apy",
    provider: "Typical high-yield savings",
    name: "High-yield savings (typical)",
    valueBps: HIGH_YIELD_SAVINGS_BPS,
    sourceUrl: "src/config/cash.ts",
    checkedOn: CASH_RATES_AS_OF,
  },
  ...STUDENT_PLANS.flatMap((plan) => {
    const merchantKey = plan.merchantKey;
    const common = {
      kind: "plan_price" as const,
      provider: plan.name,
      merchantKey,
      checkedOn: "2026-10-01",
    };
    return [
      {
        ...common,
        key: `plan.${merchantKey}.student`,
        source: "seed",
        name: `${plan.name} Student`,
        valueCents: plan.studentMonthlyCents,
        sourceUrl: "src/config/life-facts.ts",
      },
      {
        ...common,
        key: `plan.${merchantKey}.individual`,
        source: "seed",
        name: `${plan.name} Individual`,
        valueCents: plan.studentMonthlyCents + Math.round(plan.yearlySavingCents / 12),
        sourceUrl: "src/config/life-facts.ts",
      },
    ];
  }),
];
// A seed row is shown this long after the day it was written, like a source's showHours.
export const OFFER_SEED_SHOW_DAYS = 45;
