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

// Whether Jane trades the practice portfolio herself or only says what she would do.
export const AUTOPILOT_MODES = {
  suggest: {
    label: "Suggest only",
    description: "Jane says what she would do; nothing is traded, even with practice money.",
  },
  act: {
    label: "Act within the limits",
    description:
      "Jane trades the practice portfolio herself, inside every limit. Practice money only.",
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

// Things a person can ask Jane never to buy. A key here matches the companies tagged with it in
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
};

export const BROAD_FUND_NOTE =
  "Whole-market index funds hold a little of every industry; Jane won't buy those companies' own shares, but keeps the broad funds unless you name one.";

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
};

// The most any appetite can take each extra move to: the size of one action and the most of one
// holding (shares of the portfolio), and how many a month. The autopilot's own hard limits
// (AUTOPILOT_LIMITS) apply on top.
export const OPPORTUNITY_HARD_CAPS: Readonly<
  Partial<Record<ScanKind, { sizeShare: number; positionShare: number; perMonth: number }>>
> = {
  dip_buy: { sizeShare: 0.08, positionShare: AUTOPILOT_LIMITS.perEtfShare, perMonth: 3 },
  news_idea: { sizeShare: 0.015, positionShare: AUTOPILOT_LIMITS.perStockShare, perMonth: 3 },
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
