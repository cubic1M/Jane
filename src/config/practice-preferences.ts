import type { CatalogId } from "@/config/strategy-catalog";
import type { RiskLevel } from "@/config/investing";
import {
  AUTOPILOT_LIMITS,
  PRACTICE_MONTHLY_ADD_CENTS,
  type PracticeClass,
} from "@/config/portfolios";
import type { ScanKind } from "@/config/practice-scan";

// What the person can choose about the practice portfolio (Phase AW, Stage A): the choices, the
// defaults and the limits on each. Practice money only; every number is demo advice, FOR REVIEW
// before Stage B. The rules that read these are in src/planning/practice-preferences.ts. None of
// these can raise a hard limit: AUTOPILOT_LIMITS (src/config/portfolios.ts) and the opportunity
// hard caps below always win.

// Whether Jane trades the practice portfolio itself or only says what it would do.
export const AUTOPILOT_MODES = {
  suggest: {
    label: "Suggest only",
    description: "Jane says what it would do; nothing is traded, even with practice money.",
  },
  act: {
    label: "Act within the limits",
    description:
      "Jane trades the practice portfolio itself, inside every limit. Practice money only.",
  },
} as const;
export type AutopilotMode = keyof typeof AUTOPILOT_MODES;

// How many extra moves (opportunities beyond the model, step 292) the person wants. `scale`
// multiplies each opportunity's caps; the result never goes past OPPORTUNITY_HARD_CAPS.
export const APPETITES = {
  off: { label: "Off", description: "No extra moves: just the model, kept on target.", scale: 0 },
  cautious: {
    label: "Cautious",
    description: "A few small extra moves, at half the usual size.",
    scale: 0.5,
  },
  normal: { label: "Normal", description: "Extra moves at the usual size.", scale: 1 },
  adventurous: {
    label: "Adventurous",
    description: "A bit more room for extra moves, still inside the hard limits.",
    scale: 1.5,
  },
} as const;
export type Appetite = keyof typeof APPETITES;
export const APPETITE_ORDER: readonly Appetite[] = ["off", "cautious", "normal", "adventurous"];

// Things a person can ask Jane never to buy. The keys include investing by your values' exclusions
// (VALUES_EXCLUSIONS, step 236), which a new person starts with. A key here matches the companies tagged with it in
// TICKER_TAGS; a ticker matches itself. Broad index funds hold a little of every industry, so a
// key keeps Jane from buying those companies' own shares, not from holding a whole-market fund
// (said so on the page and in the chat). A fund can be avoided by its ticker.
export const EXCLUSIONS = {
  fossil_fuels: { label: "Oil, gas and coal companies" },
  tobacco: { label: "Tobacco" },
  weapons: { label: "Weapons and defence" },
  gambling: { label: "Gambling" },
  alcohol: { label: "Alcohol" },
  tech: { label: "Technology companies" },
  cars: { label: "Car makers" },
  banks: { label: "Banks and lenders" },
  crypto: { label: "Crypto" },
} as const;
export type ExclusionKey = keyof typeof EXCLUSIONS;

// What each company the practice portfolio may buy is in, for EXCLUSIONS. A company added to
// the practice universe gets its tags here (a test checks every one has them).
export const TICKER_TAGS: Readonly<Record<string, readonly ExclusionKey[]>> = {
  AAPL: ["tech"],
  MSFT: ["tech"],
  NVDA: ["tech"],
  TSLA: ["cars", "tech"],
  // The news themes' funds (src/config/themes.ts): a fund of one industry is that industry.
  XLE: ["fossil_fuels"],
  ITA: ["weapons"],
  SMH: ["tech"],
  GLD: [],
  TLT: [],
};

export const BROAD_FUND_NOTE =
  "Whole-market index funds hold a little of every industry; Jane won't buy those companies' own shares, but keeps the broad funds unless you name one.";

// The strategy the practice portfolio follows: Jane's pick for the level (the daily replay's
// choice, src/lib/investments/strategy-today.ts), the level's mix alone, or one strategy from the
// library the person picks, with fixed parameters from its grid (STRATEGY_GRID). A picked
// strategy still keeps every hard limit, and the person's settings that move the mix (a goal
// date, a whole kind avoided) still win over it.
export const STRATEGY_CHOICES = {
  level: {
    label: "Jane's pick for your level",
    description:
      "The strategy the daily replay chose for your level on real prices, or the level's mix when none beat it.",
  },
  mix: {
    label: "Just the level's mix",
    description: "The level's mix, kept on target, with no strategy on top.",
  },
  trend: {
    label: "Trend filter",
    description:
      "Each fund held only while its price is above its 6-month average; otherwise that share waits in short-term bills.",
    id: "trend",
    params: { months: 6 },
  },
  vol_target: {
    label: "Volatility target",
    description:
      "Stocks scaled down when they've been jumpy over the last 3 months, the rest in short-term bills.",
    id: "vol_target",
    params: { windowDays: 63 },
  },
  // The strategy menu's tilts (src/config/strategy-menu.ts): the level's mix, with its US stocks
  // part held in the tilt's fund instead of the whole market.
  value_tilt: {
    label: "Value tilt",
    description: "Your US stocks in a value fund (VTV): cheaper, slower-growing companies.",
    fund: "VTV",
  },
  momentum_tilt: {
    label: "Momentum tilt",
    description: "Your US stocks in a momentum fund (MTUM): the companies that rose most lately.",
    fund: "MTUM",
  },
  quality_tilt: {
    label: "Quality tilt",
    description: "Your US stocks in a quality fund (QUAL): steady profits, little debt.",
    fund: "QUAL",
  },
  dividend_growth: {
    label: "Dividend growth",
    description: "Your US stocks in a dividend-growth fund (VIG): dividends raised for 10+ years.",
    fund: "VIG",
  },
  equal_weight: {
    label: "Equal weight",
    description: "Your US stocks in an equal-weight S&P 500 fund (RSP).",
    fund: "RSP",
  },
} as const;
export type StrategyChoice = keyof typeof STRATEGY_CHOICES;

// The crypto sleeve beside the plan (src/config/crypto-strategies.ts): off, or one of the crypto
// rules. Followed at Very high only (CRYPTO_SLEEVE_BY_LEVEL); at any other level it waits, and
// what the sleeve holds is sold.
export const CRYPTO_SLEEVE_CHOICES = {
  off: { label: "Off" },
  crypto_hold: { label: "Crypto, held" },
  crypto_trend: { label: "Crypto trend" },
  crypto_momentum: { label: "Crypto momentum" },
} as const;
export type CryptoSleeveChoice = keyof typeof CRYPTO_SLEEVE_CHOICES;

// The day-trading sleeve (src/config/intraday-strategies.ts): off, or one of the intraday rules,
// in and out of the fund the same day. Very high only (INTRADAY_SLEEVE_BY_LEVEL); most day
// trading loses money, and every rule here did worse than holding.
export const DAY_TRADING_CHOICES = {
  off: { label: "Off" },
  opening_range: { label: "Opening-range break" },
  liquidity_sweep: { label: "Liquidity sweep" },
  fair_value_gap: { label: "Fair value gap" },
  vwap_reversion: { label: "VWAP reversion" },
  volume_imbalance: { label: "Volume imbalance" },
} as const;
export type DayTradingChoice = keyof typeof DAY_TRADING_CHOICES;

// A strategy from the catalog (src/config/strategy-catalog.ts) the practice portfolio follows
// instead of the level's mix, or off. Only one the research rates worth watching or
// recommendable at the person's level is followed (src/config/catalog-evidence.ts).
export type CatalogChoice = "off" | CatalogId;

// How far a kind may drift from its target before the autopilot rebalances: the person's pace.
// Normal is the autopilot's own band (AUTOPILOT_LIMITS.rebalanceBand). Rarely means fewer trades
// and more drift between them. FOR REVIEW.
export const REBALANCE_PACES = {
  often: { label: "Often", description: "When a kind is 3 points off its target.", band: 0.03 },
  normal: {
    label: "Normal",
    description: `When a kind is ${Math.round(AUTOPILOT_LIMITS.rebalanceBand * 100)} points off its target.`,
    band: AUTOPILOT_LIMITS.rebalanceBand,
  },
  rarely: {
    label: "Rarely",
    description: "When a kind is 8 points off its target: fewer trades, more drift in between.",
    band: 0.08,
  },
} as const;
export type RebalancePace = keyof typeof REBALANCE_PACES;

// What the practice portfolio may buy: the funds and the few large companies news ideas pick
// (PRACTICE_STOCKS), or the funds only.
export const UNIVERSES = {
  funds_and_stocks: {
    label: "Funds and a few big companies",
    description:
      "The index funds, plus small positions in a few large companies when a news idea fits (High and Very high).",
  },
  funds_only: {
    label: "Funds only",
    description: "Only the index funds: Jane never buys a single company's shares.",
  },
} as const;
export type Universe = keyof typeof UNIVERSES;

// The most of the portfolio one fund may be, as the person sets it (whole percent): never above
// the hard limit (AUTOPILOT_LIMITS.perEtfShare). What a lower cap keeps out of a fund stays as
// cash.
export const MAX_FUND_RANGE = {
  min: 20,
  max: Math.round(AUTOPILOT_LIMITS.perEtfShare * 100),
} as const;

// The largest drop a person can say they can live with, in whole percent.
export const MAX_DROP_RANGE = { min: 5, max: 60 } as const;

// The monthly practice money and its day. Days stop at 28 so every month has one.
export const MONTHLY_ADD_MAX_CENTS = 1_000_000;
export const ADD_DAY_RANGE = { min: 1, max: 28 } as const;

// Cash to keep uninvested in the practice portfolio.
export const CASH_BUFFER_MAX_CENTS = 1_000_000;

// A goal date is in the future and at most this many years away.
export const GOAL_MAX_YEARS = 60;

// With no saved choice. The level follows the questionnaire (step 288), so it isn't here.
export const PREFERENCE_DEFAULTS = {
  maxDropPercent: null,
  goal: null,
  goalDate: null,
  monthlyAddCents: PRACTICE_MONTHLY_ADD_CENTS,
  addDay: 1,
  appetite: "normal" as Appetite,
  avoid: [] as string[],
  harvestLosses: true,
  cashBufferCents: 0,
  mode: "act" as AutopilotMode,
  strategy: "level" as StrategyChoice,
  rebalancePace: "normal" as RebalancePace,
  universe: "funds_and_stocks" as Universe,
  maxFundPercent: null as number | null,
  cryptoSleeve: "off" as CryptoSleeveChoice,
  dayTrading: "off" as DayTradingChoice,
  catalogStrategy: "off" as CatalogChoice,
};

// The level when nothing else says one (no choice, no portfolio, no questionnaire): Medium.
export const DEFAULT_LEVEL: RiskLevel = 3;

// At most this many things to avoid.
export const AVOID_MAX = 40;

// The largest drop each level's model had in the sample replay (step 295), rounded up, in whole
// percent. A person's "largest drop I can live with" keeps the level at or below the highest one
// whose drop fits. FOR REVIEW: the backtest session tunes these from the replays.
export const LEVEL_WORST_DROP_PERCENT: Readonly<Record<RiskLevel, number>> = {
  1: 10,
  2: 15,
  3: 22,
  4: 30,
  5: 38,
};

// Which scan kinds (step 292) are extra moves, and the least appetite that allows each. Plan
// upkeep (rebalancing, loss harvesting) isn't an extra move. A new kind of opportunity is added
// here and to OPPORTUNITY_HARD_CAPS, and the appetite scales it from then on.
export const OPPORTUNITY_MIN_APPETITE: Readonly<Partial<Record<ScanKind, Appetite>>> = {
  dip_buy: "cautious",
  news_idea: "normal",
  theme_idea: "normal",
};

// The most any appetite can take each extra move to: the size of one action and the most of one
// holding (shares of the portfolio), and how many a month. The autopilot's own hard limits
// (AUTOPILOT_LIMITS) apply on top.
export const OPPORTUNITY_HARD_CAPS: Readonly<
  Partial<Record<ScanKind, { sizeShare: number; positionShare: number; perMonth: number }>>
> = {
  dip_buy: { sizeShare: 0.08, positionShare: AUTOPILOT_LIMITS.perEtfShare, perMonth: 3 },
  news_idea: { sizeShare: 0.015, positionShare: AUTOPILOT_LIMITS.perStockShare, perMonth: 3 },
  theme_idea: { sizeShare: 0.06, positionShare: AUTOPILOT_LIMITS.perThemeShare, perMonth: 2 },
};
// All opportunity stocks together, at most, whatever the appetite.
export const OPPORTUNITY_HARD_MAX_SHARE = 0.075;

// When everything that holds one kind is on the never-buy list, its share goes to this kind
// instead (and to bonds when both kinds of stocks are avoided).
export const AVOIDED_CLASS_FALLBACK: Readonly<Record<PracticeClass, PracticeClass>> = {
  us_stocks: "intl_stocks",
  intl_stocks: "us_stocks",
  bonds: "cash",
  cash: "bonds",
};
