import type { RiskLevel } from "@/config/investing";

// The events overlay (founder, 2026-10-26): a layer on top of whichever strategy the paper
// account follows. It watches current events (GDELT news coverage, the Fed's, BLS's and EIA's
// own feeds, and sharp price moves), maps each kind of event to the funds that have tended to
// move on it, and tilts the strategy's targets a little for a few weeks. It never replaces the
// strategy, never borrows or shorts, and runs on simulated money only. Rules and keyword scoring
// only: it makes no Claude call. Backtested on real history with no lookahead
// (src/planning/event-backtest.ts, docs/backtests/events.md). FOR REVIEW: every event list,
// keyword and number here.

export type EventTypeId =
  | "me_conflict"
  | "war"
  | "fed_cut"
  | "fed_hike"
  | "oil_shock"
  | "inflation_hot"
  | "market_panic"
  | "bank_stress"
  | "chip_boom"
  // Crypto (founder, 2026-10-26): for the 24-hour agent's crypto strategies, around the clock.
  | "crypto_exchange_failure"
  | "crypto_etf"
  | "crypto_regulation"
  | "stablecoin_depeg"
  | "crypto_liquidation";

// The market an event type trades in: stock funds (the paper account's strategies and the agent on
// US funds) or crypto (the agent on bitcoin and ether).
export type EventMarket = "stocks" | "crypto";

// One fund the overlay moves on an event. "buy" adds a slice; "trim" takes a slice off a fund
// the strategy holds (to cash), never below zero. The first ticker with a price is used (a proxy
// after it, for price sources that don't carry the first).
export type EventLeg = { tickers: readonly string[]; side: "buy" | "trim" };

export type EventType = {
  label: string;
  market: EventMarket;
  // The kind of fund it points to, for the box.
  theme: string;
  // Why, in a sentence, for the log and the pop-up.
  why: string;
  legs: readonly EventLeg[];
  // GDELT DOC 2.0 query: its daily share of all coverage is watched for spikes.
  gdelt: string;
  // A headline or feed item is about this type when it matches every pattern in one of these.
  keywords: readonly (readonly RegExp[])[];
};

const MIDDLE_EAST =
  /\b(iran|israel|saudi|gaza|lebanon|yemen|houthis?|hormuz|red sea|middle east|tehran)\b/i;
const ATTACK = /\b(missiles?|air ?strikes?|strikes?|struck|attacks?|attacked|drones?|bomb\w*)\b/i;

export const EVENT_TYPES: Readonly<Record<EventTypeId, EventType>> = {
  me_conflict: {
    label: "Fighting in the Middle East",
    market: "stocks",
    theme: "Energy and defense",
    why: "Fighting near the Gulf has tended to lift oil companies and defense makers for a few weeks.",
    legs: [
      { tickers: ["XLE"], side: "buy" },
      { tickers: ["ITA"], side: "buy" },
    ],
    gdelt:
      '(iran OR israel OR saudi OR hormuz OR houthi OR yemen OR lebanon) (missile OR airstrike OR "drone attack" OR strikes)',
    keywords: [[MIDDLE_EAST, ATTACK]],
  },
  war: {
    label: "A war breaks out",
    market: "stocks",
    theme: "Defense and gold",
    why: "A new war has tended to lift defense makers, and gold as a place to wait.",
    legs: [
      { tickers: ["ITA"], side: "buy" },
      { tickers: ["GLD"], side: "buy" },
    ],
    gdelt: '(invasion OR invades OR "declares war" OR "full-scale war")',
    keywords: [[/\b(invasion|invades|invaded|declares? war|full-scale war|troops cross)\b/i]],
  },
  fed_cut: {
    label: "The Fed cuts rates",
    market: "stocks",
    theme: "Long bonds",
    why: "When the Fed cuts, long-dated Treasuries have usually gained.",
    legs: [{ tickers: ["TLT", "BND"], side: "buy" }],
    gdelt:
      '("federal reserve" OR fomc) ("cuts rates" OR "cuts interest rates" OR "rate cut" OR "lowers rates")',
    keywords: [
      [/\b(fed|federal reserve|fomc)\b/i, /\b(cuts?|lowers?|slashes)\b[^.]{0,30}\brates?\b/i],
      [/\b(decided to )?lower the target range\b/i],
    ],
  },
  fed_hike: {
    label: "The Fed raises rates",
    market: "stocks",
    theme: "Banks, fewer bonds",
    why: "Higher rates have tended to help banks' margins and weigh on bonds.",
    legs: [
      { tickers: ["XLF"], side: "buy" },
      { tickers: ["BND"], side: "trim" },
    ],
    gdelt:
      '("federal reserve" OR fomc) ("raises rates" OR "raises interest rates" OR "rate hike" OR "hikes rates")',
    keywords: [
      [/\b(fed|federal reserve|fomc)\b/i, /\b(raises?|hikes?|lifts?)\b[^.]{0,30}\brates?\b/i],
      [/\b(decided to )?raise the target range\b/i],
    ],
  },
  oil_shock: {
    label: "An oil supply shock",
    market: "stocks",
    theme: "Energy and commodities",
    why: "A cut or outage in oil supply has tended to lift energy shares and commodities.",
    legs: [
      { tickers: ["XLE"], side: "buy" },
      { tickers: ["DBC"], side: "buy" },
    ],
    gdelt:
      '(opec OR "oil supply" OR "oil output" OR refinery OR pipeline) (outage OR disruption OR attack OR halt OR "output cut")',
    keywords: [
      [
        /\b(opec\+?|oil supply|oil output|crude|refiner(y|ies)|pipelines?)\b/i,
        /\b(outages?|disrupt\w*|halts?|halted|shut\w*|output cuts?|cuts? output|attack\w*)\b/i,
      ],
    ],
  },
  inflation_hot: {
    label: "Inflation runs hot",
    market: "stocks",
    theme: "Commodities and inflation-linked bonds",
    why: "A hot inflation report has tended to favour commodities and inflation-linked bonds over ordinary ones.",
    legs: [
      { tickers: ["DBC"], side: "buy" },
      { tickers: ["TIP"], side: "buy" },
      { tickers: ["BND"], side: "trim" },
    ],
    gdelt:
      '(inflation OR "consumer prices" OR "consumer price index") ("hotter than expected" OR "higher than expected" OR "biggest jump" OR "highest since")',
    keywords: [
      [
        /\b(inflation|consumer prices?|cpi)\b/i,
        /\b(hotter than expected|higher than expected|biggest (jump|rise)|highest since)\b/i,
      ],
    ],
  },
  market_panic: {
    label: "A market scare",
    market: "stocks",
    theme: "Gold and Treasuries",
    why: "In a sudden sell-off, gold and Treasuries have often held up while shares fell.",
    legs: [
      { tickers: ["GLD"], side: "buy" },
      { tickers: ["IEF", "BND"], side: "buy" },
    ],
    gdelt:
      '(stocks OR "wall street" OR "stock market") (plunge OR crash OR selloff OR rout OR "worst day")',
    keywords: [
      [
        /\b(stocks?|markets?|wall street|dow|s&p|nasdaq)\b/i,
        /\b(plunge[sd]?|plummet\w*|tumble[sd]?|rout|sell-?off|crash\w*|panic|worst day)\b/i,
      ],
    ],
  },
  bank_stress: {
    label: "Stress at the banks",
    market: "stocks",
    theme: "Gold",
    why: "When a bank fails, money has tended to move to gold while bank shares fall.",
    legs: [
      { tickers: ["GLD"], side: "buy" },
      { tickers: ["XLF"], side: "trim" },
    ],
    gdelt:
      '(bank OR banks OR lender) ("bank run" OR collapse OR "seized by regulators" OR contagion)',
    keywords: [
      [
        /\b(banks?|lenders?)\b/i,
        /\b(bank run|collapse[sd]?|fails|failed|seized|contagion|insolvent)\b/i,
      ],
    ],
  },
  chip_boom: {
    label: "A chip boom",
    market: "stocks",
    theme: "Chip makers",
    why: "Record chip demand has tended to carry chip makers for weeks after the news.",
    legs: [{ tickers: ["SMH", "NVDA"], side: "buy" }],
    gdelt:
      '(nvidia OR semiconductor OR chipmaker) (record OR "beats estimates" OR blowout OR soars)',
    keywords: [
      [
        /\b(chips?|semiconductors?|nvidia|tsmc|chipmakers?)\b/i,
        /\b(record|soars?|surges?|boom|beats? estimates|blowout)\b/i,
      ],
    ],
  },
  crypto_exchange_failure: {
    label: "A crypto exchange fails",
    market: "crypto",
    theme: "Less crypto, more cash",
    why: "When a big exchange is hacked or stops withdrawals, bitcoin and ether have tended to fall for days.",
    legs: [
      { tickers: ["BTC/USD"], side: "trim" },
      { tickers: ["ETH/USD"], side: "trim" },
    ],
    gdelt:
      '(exchange OR exchanges) (hack OR hacked OR insolvent OR bankruptcy OR "halts withdrawals" OR "froze withdrawals") (crypto OR bitcoin OR cryptocurrency)',
    keywords: [
      [
        /\b(crypto|bitcoin|cryptocurrency) exchanges?\b|\bexchanges?\b[^.]{0,40}\b(crypto|bitcoin)\b/i,
        /\b(hack(ed)?|insolvent|bankruptcy|halts? withdrawals|froze withdrawals|collapse[sd]?)\b/i,
      ],
    ],
  },
  crypto_etf: {
    label: "Crypto funds approved or flowing in",
    market: "crypto",
    theme: "Bitcoin",
    why: "Fund approvals and record inflows have tended to lift bitcoin for a few weeks.",
    legs: [{ tickers: ["BTC/USD"], side: "buy" }],
    gdelt:
      '("bitcoin etf" OR "ether etf" OR "spot bitcoin" OR "spot ether" OR "crypto etf") (approval OR approves OR approved OR inflows OR "record inflows")',
    keywords: [
      [
        /\b(bitcoin|ether|crypto) etfs?\b|\bspot (bitcoin|ether)\b/i,
        /\b(approv\w*|inflows?|record inflows)\b/i,
      ],
    ],
  },
  crypto_regulation: {
    label: "A crypto crackdown",
    market: "crypto",
    theme: "Less crypto, more cash",
    why: "A ban, a lawsuit or a crackdown on crypto has tended to weigh on bitcoin and ether.",
    legs: [
      { tickers: ["BTC/USD"], side: "trim" },
      { tickers: ["ETH/USD"], side: "trim" },
    ],
    gdelt:
      '(crypto OR bitcoin OR cryptocurrency) (crackdown OR ban OR bans OR lawsuit OR sues OR "sec charges")',
    keywords: [
      [
        /\b(crypto|bitcoin|cryptocurrenc(y|ies))\b/i,
        /\b(crackdown|bans?|banned|lawsuit|sues|sued|sec charges)\b/i,
      ],
    ],
  },
  stablecoin_depeg: {
    label: "A stablecoin loses its peg",
    market: "crypto",
    theme: "Less crypto, more cash",
    why: "When a big stablecoin slips below a dollar, the rest of crypto has tended to sell off.",
    legs: [
      { tickers: ["BTC/USD"], side: "trim" },
      { tickers: ["ETH/USD"], side: "trim" },
    ],
    gdelt:
      '(stablecoin OR tether OR usdc OR usdt) (depeg OR "loses peg" OR "lost its peg" OR "breaks peg")',
    keywords: [
      [
        /\b(stablecoins?|tether|usdc|usdt)\b/i,
        /\b(depeg\w*|loses? (its )?peg|lost its peg|breaks? (its )?peg)\b/i,
      ],
    ],
  },
  crypto_liquidation: {
    label: "A crypto liquidation cascade",
    market: "crypto",
    theme: "Bitcoin",
    why: "After a wave of forced selling, bitcoin has often bounced back over the following weeks.",
    legs: [{ tickers: ["BTC/USD"], side: "buy" }],
    gdelt: '(bitcoin OR crypto OR ether) (liquidations OR liquidated OR "liquidation cascade")',
    keywords: [
      [/\b(bitcoin|crypto|ether)\b/i, /\b(liquidations?|liquidated|liquidation cascade)\b/i],
    ],
  },
};

export const EVENT_TYPE_IDS = Object.keys(EVENT_TYPES) as EventTypeId[];
// The types for one market: stock funds or crypto.
export const eventTypesFor = (market: EventMarket) =>
  EVENT_TYPE_IDS.filter((t) => EVENT_TYPES[t].market === market);

// --- Spotting an event in GDELT's coverage (src/planning/event-detect.ts) ---
// A day is an event when its share of all coverage is at least this many times the median of the
// days before it, with at least the minimum count of articles.
export const GDELT_SPIKE_RATIO = 2.5;
export const GDELT_BASELINE_DAYS = 30;
export const GDELT_MIN_ARTICLES = 200;
// The same, for one hour within the day (the crypto types' intraday check).
export const GDELT_MIN_HOURLY_ARTICLES = 25;
// How far back the intraday check reads, in hours (GDELT answers a short window in 15 minutes).
export const GDELT_INTRADAY_HOURS = 36;
// One event per type in this many days: the news of one event runs for days.
export const EVENT_COOL_OFF_DAYS = 15;

// --- Price shocks: a day's move in a fund, close to close, beyond these ---
export const PRICE_SHOCKS: readonly {
  ticker: string;
  // Down moves are negative.
  move: number;
  type: EventTypeId;
  // The ticker the daily closes are asked for under, when the price source names it differently.
  fetchAs?: string;
}[] = [
  { ticker: "VTI", move: -0.035, type: "market_panic" },
  { ticker: "XLE", move: 0.05, type: "oil_shock" },
  { ticker: "XLF", move: -0.05, type: "bank_stress" },
  // Bitcoin's day, close to close (Yahoo's BTC-USD for the live check).
  { ticker: "BTC/USD", move: -0.08, type: "crypto_liquidation", fetchAs: "BTC-USD" },
];

// --- A US CPI release (BLS) is hot when all items rose at least this much in the month ---
export const CPI_HOT_MONTHLY_PCT = 0.5;

// --- How the overlay sizes and exits (src/planning/event-overlay.ts) ---
// The slice one event moves, as a share of the account, by level, split across its legs; and all
// open event slices together, at most. Very low risk takes the smallest. FOR REVIEW.
export const EVENT_TILT_BY_LEVEL: Readonly<Record<RiskLevel, number>> = {
  1: 0.01,
  2: 0.015,
  3: 0.02,
  4: 0.03,
  5: 0.04,
};
export const EVENT_MAX_EXPOSURE_BY_LEVEL: Readonly<Record<RiskLevel, number>> = {
  1: 0.03,
  2: 0.05,
  3: 0.08,
  4: 0.1,
  5: 0.12,
};
// Out after this many trading days, or sooner when a bought fund falls this far from its entry
// (a trimmed fund: rises this far, and the trim is undone).
export const EVENT_HOLD_DAYS = 20;
export const EVENT_STOP = 0.07;
// Each trade, in basis points of what changes hands (the backtest charges both sides).
export const EVENT_COST_BPS = 5;

// --- Live (src/lib/events/run.ts) ---
// Events this many days old or newer are fresh: the daily job stores them, and switching the
// overlay on acts on them, never on older news. Long enough to span a weekend.
export const EVENT_FRESH_DAYS = 5;
// A paper account that missed days catches up this many closes at most.
export const EVENT_CATCH_UP_DAYS = 10;
// Events are stored this many days back (the box shows the most recent even when none is fresh).
export const EVENT_STORE_DAYS = 30;

// --- Refreshing (src/lib/events/refresh.ts): the daily cron reads every source; opening the
// investments page refreshes too when the last check is older than this, one request at a time
// (a lock), so a busy page never asks GDELT more than once in EVENTS_REFRESH_MINUTES. ---
export const EVENTS_REFRESH_MINUTES = 60;
// A claimed refresh that never finished frees the lock after this long.
export const EVENTS_LOCK_SECONDS = 240;
// A page view's refresh asks GDELT about this many event types (the least recently checked),
// so it finishes inside a page's time; the cron asks about all of them.
export const EVENTS_VIEW_GDELT_TYPES = 3;
// The sources watched, for the box ("Watching N sources").
export const EVENT_SOURCE_LABELS: Readonly<Record<string, string>> = {
  gdelt: "GDELT news coverage",
  fed: "Federal Reserve statements",
  bls_cpi: "BLS inflation releases",
  eia: "EIA energy news",
  headlines: "Stored headlines",
  prices: "Sharp price moves",
};

// --- How sure: each type's own record so far, never the future ---
// A type starts at EVENT_PRIOR_CONFIDENCE (a coin flip) worth EVENT_PRIOR_WEIGHT past events, and
// moves with each closed event: a hit beat just holding the strategy over the same days.
export const EVENT_PRIOR_CONFIDENCE = 0.5;
export const EVENT_PRIOR_WEIGHT = 4;
// The overlay acts only at or above this; below it the box shows the type as "watching".
export const EVENT_MIN_CONFIDENCE = 50;
// Shown between these, so a short record never reads as certain.
export const EVENT_CONFIDENCE_FLOOR = 5;
export const EVENT_CONFIDENCE_CEILING = 90;

// --- The live feeds (src/lib/events/feeds.ts): free, keyless ---
export const EVENT_FEEDS = {
  fed: "https://www.federalreserve.gov/feeds/press_monetary.xml",
  bls_cpi: "https://www.bls.gov/feed/cpi.rss",
  eia: "https://www.eia.gov/rss/todayinenergy.xml",
} as const;
export const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
// GDELT asks for one request every 5 seconds.
export const GDELT_SPACING_MS = 5_500;
// Every caller names itself; no key is needed.
export const EVENTS_USER_AGENT = "Jane (personal finance app; events overlay)";
