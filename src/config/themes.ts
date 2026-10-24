import type { RiskLevel } from "@/config/investing";

// News themes for the practice portfolio (Phase AW, Stage A, demo advice only): a kind of event
// in the news (a Middle East supply shock, a war, a market scare, a rate cut, a chip boom) and
// the liquid fund that has tended to move on it. When the news feed (step 293) carries such an
// event, Jane brings a practice idea: why now, the risk, a slice capped by the level, and when
// to get out. Every theme is backtested on its past events (src/planning/themes.ts, on the real
// closes in src/lib/market/__fixtures__/real) and THEME_EVIDENCE records the result; a theme
// whose events never held up isn't offered. Practice money only: nothing real is bought. FOR
// REVIEW: the event lists and every number here.

export type ThemeId =
  "middle_east_oil" | "conflict_defense" | "risk_off_gold" | "rate_cut_bonds" | "chip_boom";

export type Theme = {
  label: string;
  // What it is, in a line, for the card.
  what: string;
  // The fund bought, and what it holds.
  ticker: string;
  fund: string;
  // A headline is about the theme when it matches every one of these.
  triggers: readonly RegExp[];
  // How the risk reads on the card.
  risk: string;
  // Other funds tested on the same events and shown beside it (THEME_ALTERNATIVE_EVIDENCE),
  // never offered in its place: choosing the fund after seeing the results would be fitting the
  // past.
  alternatives?: readonly string[];
  // Past days the theme's news broke (the first trading day on or after), for the backtest.
  // Sources: news archives (Reuters, AP), the Fed's statements; FOR REVIEW.
  events: readonly string[];
};

const MIDDLE_EAST =
  /\b(iran|israel|saudi|gaza|lebanon|yemen|houthis?|hormuz|red sea|gulf of oman|middle east|tehran)\b/i;
const CONFLICT =
  /\b(war|strikes?|struck|attacks?|attacked|missiles?|drones?|invades?|invasion|blockade|conflict|troops)\b/i;

export const THEMES: Readonly<Record<ThemeId, Theme>> = {
  middle_east_oil: {
    label: "Energy after a Middle East supply shock",
    what: "Fighting near the Gulf has tended to lift oil and energy shares for a few weeks.",
    ticker: "XLE",
    fund: "Energy Select Sector SPDR (US oil and gas companies)",
    triggers: [MIDDLE_EAST, CONFLICT],
    risk: "Oil can give the jump back within days if supplies keep flowing.",
    alternatives: ["USO"],
    events: [
      "2019-06-13", // Tankers attacked in the Gulf of Oman
      "2019-09-16", // Drone strike on Saudi Aramco's Abqaiq plant (Sat Sep 14)
      "2020-01-03", // US strike kills Iran's General Soleimani
      "2023-10-09", // Hamas attack on Israel (Sat Oct 7)
      "2024-01-12", // US and UK strike the Houthis in Yemen
      "2024-04-15", // Iran's drone and missile attack on Israel (Sat Apr 13)
      "2024-10-01", // Iran's missile attack on Israel
      "2025-06-13", // Israel strikes Iran
      "2025-06-23", // US strikes Iran's nuclear sites (Sat Jun 21)
    ],
  },
  conflict_defense: {
    label: "Defense when a war breaks out",
    what: "A new war has tended to lift defense makers as governments plan to spend more.",
    ticker: "ITA",
    fund: "iShares US Aerospace & Defense (US defense and aircraft makers)",
    triggers: [CONFLICT, /\b(war|invasion|invades?|troops|missiles?)\b/i],
    risk: "Defense shares also hold airlines and plane makers, which a war can hurt.",
    events: [
      "2017-04-07", // US missile strike on Syria
      "2017-08-09", // North Korea: "fire and fury" (Aug 8 evening)
      "2020-01-03", // US strike kills Iran's General Soleimani
      "2022-02-24", // Russia invades Ukraine
      "2023-10-09", // Hamas attack on Israel (Sat Oct 7)
      "2024-04-15", // Iran's attack on Israel (Sat Apr 13)
      "2025-06-13", // Israel strikes Iran
    ],
  },
  risk_off_gold: {
    label: "Gold in a market scare",
    what: "In a sudden sell-off, gold has often held up while shares fell.",
    ticker: "GLD",
    fund: "SPDR Gold Shares (gold held in vaults)",
    triggers: [
      /\b(stocks?|markets?|shares|wall street|dow|s&p|nasdaq)\b/i,
      /\b(plunge|plunges|plummet|tumble|tumbles|rout|sell-?off|crash|panic|fear|turmoil)\b/i,
    ],
    risk: "Gold pays nothing and can fall too when cash is scarce, as in March 2020.",
    alternatives: ["IEF", "TLT"],
    events: [
      "2018-02-05", // The VIX blow-up ("Volmageddon")
      "2018-10-10", // October 2018 sell-off
      "2019-08-05", // Yuan below 7, trade-war rout
      "2020-02-24", // Covid spreads to Italy
      "2022-06-13", // Hot inflation report, bear market
      "2023-03-13", // Silicon Valley Bank fails (Fri Mar 10)
      "2024-08-05", // Yen carry-trade unwind
      "2025-04-03", // Tariff announcement rout
    ],
  },
  rate_cut_bonds: {
    label: "Long bonds when the Fed cuts rates",
    what: "When the Fed starts cutting, long-dated Treasuries have usually gained.",
    ticker: "TLT",
    fund: "iShares 20+ Year Treasury Bond (long US government bonds)",
    triggers: [
      /\b(fed|federal reserve|fomc|powell)\b/i,
      /\b(cuts?|lowers?|slashes)\b/i,
      /\brates?\b/i,
    ],
    risk: "Long bonds swing a lot: if inflation worries come back they can fall fast.",
    events: [
      "2019-07-31",
      "2019-09-18",
      "2019-10-30",
      "2020-03-03",
      "2020-03-16", // Emergency cut (Sun Mar 15)
      "2024-09-18",
      "2024-11-07",
      "2024-12-18",
      "2025-09-17",
      "2025-10-29",
      "2025-12-10",
    ],
  },
  chip_boom: {
    label: "Chip makers in a chip boom",
    what: "Record chip demand has tended to carry chip makers for weeks after the news.",
    ticker: "SMH",
    fund: "VanEck Semiconductor (the largest chip makers)",
    triggers: [
      /\b(chips?|semiconductors?|nvidia|tsmc|ai chip)\b/i,
      /\b(record|soars?|surges?|boom|beats?|blowout|demand)\b/i,
    ],
    risk: "Chip shares are among the most volatile: a 30% fall in weeks has happened often.",
    events: [
      // The trading day after each of Nvidia's quarterly results.
      "2023-05-25",
      "2023-08-24",
      "2023-11-22",
      "2024-02-22",
      "2024-05-23",
      "2024-08-29",
      "2024-11-21",
      "2025-02-27",
      "2025-05-29",
      "2025-08-28",
    ],
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

// The levels a theme idea comes up at, and the most of the portfolio one theme may be: small,
// a slice beside the plan, never the plan. FOR REVIEW.
export const THEME_SLICE_BY_LEVEL: Readonly<Partial<Record<RiskLevel, number>>> = {
  3: 0.02,
  4: 0.04,
  5: 0.06,
};
// All theme slices together, at most.
export const THEME_MAX_SHARE = 0.1;
// When to get out: after this many trading days (about a month), or sooner if it falls this
// far from what it was bought at. The backtest tests the same exit.
export const THEME_HOLD_DAYS = 20;
export const THEME_STOP_LOSS = 0.08;
// A buy and its sale, each, in basis points of what changes hands.
export const THEME_COST_BPS = 5;
// A theme is offered only when, on its past events, it beat the whole US market (VTI) over
// the same days on average and in at least this share of them.
export const THEME_MIN_HIT_RATE = 0.5;
// The fund the backtest compares against.
export const THEME_BENCHMARK = "VTI";
// News within this many days counts as now.
export const THEME_NEWS_DAYS = 2;
// One idea per theme in this many days.
export const THEME_REPEAT_DAYS = 30;
