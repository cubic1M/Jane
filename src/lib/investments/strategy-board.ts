import {
  CATALOG_CURVES,
  CATALOG_CURVE_DATES,
  CATALOG_CURVES_SOURCE,
} from "@/config/catalog-curves";
import { CATALOG_EVIDENCE, CATALOG_EVIDENCE_SOURCE } from "@/config/catalog-evidence";
import { CATALOG_REGIME_EVIDENCE } from "@/config/catalog-regimes";
import { CRYPTO_EVIDENCE, CRYPTO_EVIDENCE_SOURCE } from "@/config/crypto-evidence";
import {
  CRYPTO_SLEEVE_BY_LEVEL,
  CRYPTO_STRATEGIES,
  CRYPTO_STRATEGY_IDS,
  CRYPTO_WARNING,
  type CryptoStrategyId,
} from "@/config/crypto-strategies";
import { INTRADAY_EVIDENCE, INTRADAY_EVIDENCE_SOURCE } from "@/config/intraday-evidence";
import {
  INTRADAY_RULE_IDS,
  INTRADAY_RULES,
  INTRADAY_WARNING,
  type IntradayRuleId,
} from "@/config/intraday-strategies";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { STRATEGY_CHOICES, type StrategyChoice } from "@/config/practice-preferences";
import {
  STRATEGY_NOT_A_FORECAST,
  STRATEGY_RESEARCH_CHOICE,
  type StrategyId,
} from "@/config/strategies";
import {
  CATALOG,
  CATALOG_IDS,
  CATALOG_WALK_FROM_YEAR,
  type CatalogId,
} from "@/config/strategy-catalog";
import { STRATEGY_LINES } from "@/config/strategy-lines";

// The investments page's strategy board (founder: "show the graph showing the different
// investment strategies, and list all the ones you tested right below the specific risk
// tolerance"): for one risk level, every strategy tested there as a row with its status, its
// numbers and its line on one graph, against the level's own mix. Built from the stored
// research only (src/config/catalog-curves.ts and the evidence files): no prices are fetched.
// Pure. Practice money and demo advice only; a replay of the past, never a forecast.

export type BoardStatus = "default" | "recommended" | "watch" | "tested" | "lost";

export const STATUS_TAGS: Readonly<Record<BoardStatus, string>> = {
  default: "DEFAULT",
  recommended: "RECOMMENDED",
  watch: "WORTH WATCHING",
  tested: "TESTED, NOT RECOMMENDED",
  lost: "LOST MONEY AFTER COSTS",
};

// The order the list reads in: the default first, what lost money last.
const STATUS_ORDER: readonly BoardStatus[] = ["default", "recommended", "watch", "tested", "lost"];

// Whether a row can be run in the practice portfolio (at the person's own level): at once, after
// a one-line warning (it lost money in the replay), or not at all, with why.
export type BoardUse =
  { kind: "yes" } | { kind: "confirm"; warning: string } | { kind: "no"; why: string };

export const LOST_WARNING = "This lost money after costs in the replay. Use it anyway?";

export type BoardRow = {
  key: string;
  label: string;
  line: string;
  status: BoardStatus;
  cagr: number;
  maxDrawdown: number;
  sortino: number;
  // The years its numbers cover: "since 2020".
  since: string;
  // Behind "More": the evidence, a sentence each.
  more: string[];
  // Through past regimes, at its published setting (descriptive, not out of sample).
  regimes: { label: string; strategy: number; mix: number | null }[];
  // Its path on the board's dates, from 100; null where it hadn't started.
  values: (number | null)[];
  // The practice portfolio follows it now.
  current: boolean;
  use: BoardUse;
};

export type Board = {
  level: RiskLevel;
  // The person's own level (the buttons show only there).
  yours: boolean;
  // What the level means, in a line.
  levelLine: string;
  notForecast: string;
  dates: readonly string[];
  mix: {
    label: string;
    values: (number | null)[];
    cagr: number;
    maxDrawdown: number;
    sortino: number;
  };
  rows: BoardRow[];
  // The row drawn bold first: what the practice portfolio follows, else the default.
  highlighted: string;
  // A strategy chosen elsewhere (settings, the chat) that isn't on the list, in words.
  followsElsewhere: string | null;
  sources: string[];
};

export type BoardInput = {
  level: RiskLevel;
  // The person's own level, and what their practice portfolio runs now.
  yourLevel: RiskLevel;
  choice: StrategyChoice;
  catalog: CatalogId | null;
  crypto: CryptoStrategyId | null;
  dayTrading: IntradayRuleId | null;
};

// What Jane's pick for a level does, in a line.
const PICK_LINES: Readonly<Record<StrategyId, string>> = {
  static: "Your level's mix, kept on target.",
  inverse_vol: "Your mix, each part sized by how much it swings.",
  vol_target: "Fewer stocks when markets get jumpy.",
  trend: "Your mix, each fund out to cash below its 6-month average.",
  dual_momentum: "The stronger of US and foreign stocks, or bonds.",
  min_variance: "Your mix weighted for the smallest swings.",
  cppi: "Less in stocks as the portfolio nears a floor.",
};

const pct = (n: number) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;
const num = (n: number) => n.toFixed(2);
const sentence = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}.`;

// A curve of `points` evenly spaced from `from` to `to`, read on the board's dates (straight
// between points); null before it starts.
export function onDates(
  points: readonly number[],
  from: string,
  to: string,
  dates: readonly string[],
): (number | null)[] {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return dates.map((d) => {
    const t = Date.parse(d);
    if (t < a || points.length === 0) return null;
    const f = Math.min(1, (t - a) / Math.max(1, b - a)) * (points.length - 1);
    const i = Math.floor(f);
    const j = Math.min(points.length - 1, i + 1);
    return Math.round((points[i] + (points[j] - points[i]) * (f - i)) * 10) / 10;
  });
}

// Tested strategies the practice portfolio can also run as a plain tilt of the mix (the same
// rule: the level's US-stocks share in the fund), through the strategy setting.
const TILTS: Partial<Record<CatalogId, StrategyChoice>> = {
  value: "value_tilt",
  momentum: "momentum_tilt",
  quality: "quality_tilt",
  dividend_growth: "dividend_growth",
  equal_weight: "equal_weight",
};

function catalogRows(input: BoardInput, yours: boolean): BoardRow[] {
  const { level } = input;
  const curves = CATALOG_CURVES[level];
  return CATALOG_IDS.flatMap((id) => {
    const e = CATALOG_EVIDENCE[id]?.[level];
    if (!e) return [];
    const status: BoardStatus = e.recommendable
      ? "recommended"
      : e.cagr < 0
        ? "lost"
        : e.watch
          ? "watch"
          : "tested";
    const tilt = TILTS[id];
    const followed = input.catalog === id;
    const tilted = input.catalog === null && tilt !== undefined && input.choice === tilt;
    const current = yours && (followed || tilted);
    const use: BoardUse =
      CATALOG[id].kind === "sleeve"
        ? { kind: "no", why: "It runs beside your mix's bonds, so it isn't run on its own." }
        : status === "lost"
          ? { kind: "confirm", warning: LOST_WARNING }
          : { kind: "yes" };
    const regimes = (CATALOG_REGIME_EVIDENCE[id]?.[level] ?? []).flatMap((g) =>
      g.label !== "2008" && g.strategy !== null
        ? [{ label: g.label, strategy: g.strategy, mix: g.mix }]
        : [],
    );
    return [
      {
        key: `catalog:${id}`,
        label: CATALOG[id].label,
        line: STRATEGY_LINES[id],
        status,
        cagr: e.cagr,
        maxDrawdown: e.maxDrawdown,
        sortino: e.sortino,
        since: `since ${CATALOG_WALK_FROM_YEAR}`,
        more: [
          `Since ${CATALOG_WALK_FROM_YEAR}, each year on the setting chosen on the years before, after costs: ${pct(e.cagr)} a year, worst drop ${pct(e.maxDrawdown)}, Sortino ${num(e.sortino)}. Your mix: ${pct(e.mixCagr)} a year, Sortino ${num(e.mixSortino)}.`,
          `Chance the edge is real, after the haircut for testing so many: ${Math.round(e.dsr * 100)}%.`,
          // Worth watching fails only the haircut, which the line above already says.
          ...(e.recommendable
            ? ["Beat your mix by enough to rule out luck."]
            : e.watch
              ? []
              : [sentence(e.why)]),
          `How it works: ${CATALOG[id].rules}`,
          `From: ${CATALOG[id].source.title}.`,
        ],
        regimes,
        values: curves.strategies[id] ?? CATALOG_CURVE_DATES.map(() => null),
        current,
        use,
      },
    ];
  });
}

// Crypto and day trading, at Very high only.
function veryHighRows(input: BoardInput, yours: boolean): BoardRow[] {
  if (input.level !== 5) return [];
  const crypto = CRYPTO_STRATEGY_IDS.map((id): BoardRow => {
    const r = CRYPTO_EVIDENCE[id];
    const s = CRYPTO_STRATEGIES[id];
    const current = yours && input.crypto === id;
    const open = CRYPTO_SLEEVE_BY_LEVEL[input.level] !== undefined;
    return {
      key: `crypto:${id}`,
      label: s.label,
      line: s.line,
      status: r.later.cagr < 0 ? "lost" : r.beatsHolding ? "watch" : "tested",
      cagr: r.later.cagr,
      maxDrawdown: r.later.maxDrawdown,
      sortino: r.later.sortino,
      since: `since ${r.later.from.slice(0, 4)}`,
      more: [
        CRYPTO_WARNING,
        `A small sleeve, ${Math.round((CRYPTO_SLEEVE_BY_LEVEL[5] ?? 0) * 100)}% of the portfolio at most. Its setting was chosen on ${r.train.from.slice(0, 4)} to ${r.train.to.slice(0, 4)}, then replayed from ${r.later.from.slice(0, 4)} after fees and slippage.`,
        id === "crypto_hold"
          ? `Held: ${pct(r.later.cagr)} a year, worst drop ${pct(r.later.maxDrawdown)}.`
          : `Simply holding: ${pct(r.holdLater.cagr)} a year, worst drop ${pct(r.holdLater.maxDrawdown)}. ${r.beatsHolding ? "More return for its risk than holding." : "Less return for its risk than holding."}`,
        `How it works: ${s.how}`,
      ],
      regimes: [],
      values: onDates(r.curve, r.later.from, r.later.to, CATALOG_CURVE_DATES),
      current,
      use: !open
        ? { kind: "no", why: "Crypto is offered at Very high only." }
        : r.later.cagr < 0
          ? { kind: "confirm", warning: LOST_WARNING }
          : { kind: "yes" },
    };
  });
  const day = INTRADAY_RULE_IDS.map((id): BoardRow => {
    const r = INTRADAY_EVIDENCE[id];
    const s = INTRADAY_RULES[id];
    return {
      key: `intraday:${id}`,
      label: `Day trading: ${s.label}`,
      line: s.line,
      status: r.later.cagr <= 0 ? "lost" : "tested",
      cagr: r.later.cagr,
      maxDrawdown: r.later.maxDrawdown,
      sortino: r.later.sortino,
      since: `since ${r.later.from.slice(0, 4)}`,
      more: [
        INTRADAY_WARNING,
        `On 5-minute bars, its setting chosen on ${r.train.from.slice(0, 4)} to ${r.train.to.slice(0, 4)}, then replayed from ${r.later.from.slice(0, 4)} after slippage: ${r.later.trades} trades, ${pct(r.later.winRate)} won. Holding the fund: ${pct(r.holdLater.cagr)} a year.`,
        "Not offered in practice.",
      ],
      regimes: [],
      values: onDates(r.curve, r.later.from, r.later.to, CATALOG_CURVE_DATES),
      current: false,
      use: {
        kind: "no",
        why: "Not offered: every day-trading rule we tested lost money after costs.",
      },
    };
  });
  return [...crypto, ...day];
}

export function strategyBoard(input: BoardInput): Board {
  const { level } = input;
  const yours = level === input.yourLevel;
  const curves = CATALOG_CURVES[level];
  const research = STRATEGY_RESEARCH_CHOICE[level];
  const pick = curves.pick;
  const onDefault = yours && input.catalog === null && input.choice === "level";
  const defaultRow: BoardRow = {
    key: "default",
    label: `Jane's pick: ${research.id === "static" ? "your mix" : (pick?.label ?? "your mix")}`,
    line: PICK_LINES[research.id],
    status: "default",
    cagr: pick?.stats.cagr ?? curves.mix.stats.cagr,
    maxDrawdown: pick?.stats.maxDrawdown ?? curves.mix.stats.maxDrawdown,
    sortino: pick?.stats.sortino ?? curves.mix.stats.sortino,
    since: `since ${CATALOG_WALK_FROM_YEAR}`,
    more: [
      `What the practice portfolio runs at ${RISK_LEVELS[level].label} unless you choose another.`,
      research.why,
      `Since ${CATALOG_WALK_FROM_YEAR}, after costs: ${pct(pick?.stats.cagr ?? 0)} a year, worst drop ${pct(pick?.stats.maxDrawdown ?? 0)}. Your mix: ${pct(curves.mix.stats.cagr)} a year, worst drop ${pct(curves.mix.stats.maxDrawdown)}.`,
    ],
    regimes: [],
    values: pick?.values ?? curves.mix.values,
    current: onDefault,
    use: { kind: "yes" },
  };
  const rest = [...catalogRows(input, yours), ...veryHighRows(input, yours)].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.sortino - a.sortino,
  );
  const rows = [defaultRow, ...rest];
  const followsElsewhere =
    yours && input.catalog === null && input.choice !== "level" && !rows.some((r) => r.current)
      ? STRATEGY_CHOICES[input.choice].label
      : null;
  return {
    level,
    yours,
    levelLine: `${RISK_LEVELS[level].label}: ${RISK_LEVELS[level].description}`,
    notForecast: STRATEGY_NOT_A_FORECAST,
    dates: CATALOG_CURVE_DATES,
    mix: {
      label: `Your level's mix (${RISK_LEVELS[level].label})`,
      values: curves.mix.values,
      ...curves.mix.stats,
    },
    rows,
    highlighted: rows.find((r) => r.current)?.key ?? "default",
    followsElsewhere,
    sources: [
      `Strategies: ${CATALOG_EVIDENCE_SOURCE}`,
      `Graph: ${CATALOG_CURVES_SOURCE}`,
      ...(level === 5
        ? [`Crypto: ${CRYPTO_EVIDENCE_SOURCE}`, `Day trading: ${INTRADAY_EVIDENCE_SOURCE}`]
        : []),
    ],
  };
}

// The graph's ranges: from the first date on or after `from` to the last.
export const BOARD_RANGES = [
  {
    key: "2020",
    label: `Since ${CATALOG_WALK_FROM_YEAR}`,
    from: `${CATALOG_WALK_FROM_YEAR - 1}-12-31`,
  },
  { key: "2022", label: "Since 2022", from: "2021-12-31" },
  { key: "1y", label: "Past year", from: null },
] as const;
export type BoardRangeKey = (typeof BOARD_RANGES)[number]["key"];

// The board over a range: the mix from 100 at its start; each line from the mix's value where
// it starts (100 when it starts with the range), so every line reads as $100 put in then.
export function boardInRange(
  board: Pick<Board, "dates" | "mix" | "rows">,
  key: BoardRangeKey,
): { dates: string[]; mix: number[]; lines: Record<string, (number | null)[]> } {
  const range = BOARD_RANGES.find((r) => r.key === key) ?? BOARD_RANGES[0];
  const last = board.dates.at(-1) ?? "";
  const from =
    range.from ?? `${Number(last.slice(0, 4)) - 1}-${last.slice(5, 7)}-${last.slice(8, 10)}`;
  let i0 = board.dates.findIndex((d) => d >= from);
  if (i0 < 0) i0 = 0;
  // A range that starts between month ends begins at the month end before it.
  if (board.dates[i0] > from && i0 > 0) i0 -= 1;
  const dates = board.dates.slice(i0);
  const rawMix = board.mix.values.slice(i0);
  const m0 = rawMix[0] ?? 100;
  const mix = rawMix.map((v) => Math.round(((v ?? m0) / m0) * 1000) / 10);
  const lines: Record<string, (number | null)[]> = {};
  for (const row of board.rows) {
    const vs = row.values.slice(i0);
    const j = vs.findIndex((v) => v !== null);
    if (j < 0) {
      lines[row.key] = vs.map(() => null);
      continue;
    }
    const scale = (j === 0 ? 100 : mix[j]) / (vs[j] as number);
    lines[row.key] = vs.map((v) => (v === null ? null : Math.round(v * scale * 10) / 10));
  }
  return { dates, mix, lines };
}
