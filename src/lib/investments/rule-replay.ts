import {
  BACKTEST_MIN_REAL_DAYS,
  BACKTEST_START_CENTS,
  REAL_HISTORY_NOTE,
  RULE_REPLAY_ADD_DAY,
  RULE_REPLAY_NOTE,
  RULE_REPLAY_SAMPLE_NOTE,
  RULE_REPLAY_STRESS,
  RULE_REPLAY_TRADE_COST_BPS,
  RULE_REPLAY_WORSE_POINTS,
  SAMPLE_HISTORY_NOTE,
} from "@/config/backtest";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import {
  OPPORTUNITY_LEVELS,
  PRACTICE_MONTHLY_ADD_CENTS,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  PRACTICE_UNIVERSE,
} from "@/config/portfolios";
import {
  OPPORTUNITY_RULES,
  OPPORTUNITY_RULES_OFF,
  rulesOnAt,
  SCAN_LABELS,
  type OpportunityRule,
  type ScanKind,
} from "@/config/practice-scan";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { HISTORY_START, storedHistory } from "@/lib/market/history";
import { SAMPLE_START, SampleMarketData } from "@/lib/market/sample";
import type { Bar, Headline } from "@/lib/market/types";
import { longDate } from "./backtest";
import {
  replayDays,
  replayRules,
  ruleEffect,
  stressDrop,
  type ReplayResult,
  type RuleEffect,
  type Strategy,
} from "@/planning/rule-replay";

// "Did the extra rules help?" (the rule replay) for the backtest view and Jane's backtest tool:
// for each level, the autopilot with its opportunity rules against plain rebalancing and buy and
// hold, over the same history the model backtests use, and each opportunity rule's own effect
// (the replay with it against the replay without it). Real stored history when the model
// backtests use it, else the sample market, said so; the sample is read directly, never through
// marketData(), so a replay never calls a live service. A replay, never a forecast; demo advice.

export type StrategySummary = {
  strategy: Strategy;
  totalReturn: number;
  worstDrop: number;
  stress: { label: string; fraction: number | null }[];
  trades: number;
  costCents: number;
  putInCents: number;
  endCents: number;
  harvestedLossCents: number;
};

export type RuleVerdict = {
  rule: OpportunityRule;
  label: string;
  // "off": turned off at this level (OPPORTUNITY_RULES_OFF); the figures are still the replay's.
  status: RuleEffect | "off" | "not_replayed" | "not_at_level";
  // Percentage points, with the rule minus without it; null when not replayed.
  returnPoints: number | null;
  dropPoints: number | null;
  // How often the rule acted in the replay with it.
  acted: number;
  why: string;
};

export type LevelRuleReplay = {
  level: RiskLevel;
  label: string;
  strategies: Record<Strategy, StrategySummary>;
  verdicts: RuleVerdict[];
};

export type RuleReplays = {
  notAForecast: string;
  from: string;
  to: string;
  levels: LevelRuleReplay[];
  // Tickers a rule needs that the history doesn't have (no replay of that rule then).
  missing: string[];
  headlines: { count: number; since: string | null };
  assumptions: {
    startCents: number;
    monthlyAddCents: number;
    tradeCostBps: number;
    worsePoints: number;
  };
};

const LEVELS = [1, 2, 3, 4, 5] as const satisfies readonly RiskLevel[];
const pts = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)} points`;

function summary(r: ReplayResult): StrategySummary {
  return {
    strategy: r.strategy,
    totalReturn: r.totalReturn,
    worstDrop: r.worstDrop.fraction,
    stress: RULE_REPLAY_STRESS.map((p) => stressDrop(r.index, p)),
    trades: r.trades.length,
    costCents: r.costCents,
    putInCents: r.putInCents,
    endCents: r.endCents,
    harvestedLossCents: r.harvestedLossCents,
  };
}

// What each rule needs beyond the four model funds.
function needs(rule: OpportunityRule): string[] {
  if (rule === "tax_loss_harvest") return ["ITOT", "IXUS", "AGG"];
  if (rule === "news_idea") return [...PRACTICE_STOCKS];
  return [];
}

export function ruleReplays(
  bars: Readonly<Record<string, readonly Bar[]>>,
  headlines: readonly Headline[],
  levels: readonly RiskLevel[] = LEVELS,
): RuleReplays | null {
  const has = (t: string) => (bars[t]?.length ?? 0) > 0;
  const missing = [...PRACTICE_UNIVERSE].filter((t) => !has(t)).sort();
  const run = (level: RiskLevel, strategy: Strategy, rules?: ReadonlySet<ScanKind>) =>
    replayRules({
      level,
      bars,
      headlines,
      startCents: BACKTEST_START_CENTS,
      monthlyAddCents: PRACTICE_MONTHLY_ADD_CENTS,
      addDay: RULE_REPLAY_ADD_DAY,
      strategy,
      rules,
      tradeCostBps: RULE_REPLAY_TRADE_COST_BPS,
    });

  const out: LevelRuleReplay[] = [];
  let span = { from: "", to: "" };
  for (const level of levels) {
    const on = rulesOnAt(level);
    const withRules = run(level, "rules", on);
    const rebalance = run(level, "rebalance");
    const hold = run(level, "hold");
    if (!withRules || !rebalance || !hold) return null;
    span = { from: withRules.from, to: withRules.to };
    const news = headlines.filter((h) => h.date >= span.from && h.date <= span.to).length;
    const verdicts = OPPORTUNITY_RULES.map((rule): RuleVerdict => {
      const label = SCAN_LABELS[rule];
      const base = { rule, label, returnPoints: null, dropPoints: null, acted: 0 };
      if (rule === "news_idea" && !OPPORTUNITY_LEVELS.includes(level))
        return { ...base, status: "not_at_level", why: "Only at High and Very high." };
      const lacking = needs(rule).filter((t) => !has(t));
      if (lacking.length > 0)
        return {
          ...base,
          status: "not_replayed",
          why: `Not replayed: no history for ${lacking.join(", ")} yet.`,
        };
      if (rule === "news_idea" && news === 0)
        return {
          ...base,
          status: "not_replayed",
          why: "Not replayed: no headlines stored for these dates.",
        };
      // The replay with the rule and the same replay without it.
      const isOn = on.has(rule);
      const withIt = isOn ? withRules : run(level, "rules", new Set([...on, rule]));
      const without = isOn
        ? run(level, "rules", new Set([...on].filter((k) => k !== rule)))
        : withRules;
      if (!withIt || !without) return { ...base, status: "not_replayed", why: "Not replayed." };
      const acted = withIt.acted[rule] ?? 0;
      const { effect, returnPoints, dropPoints } = ruleEffect(
        withIt,
        without,
        RULE_REPLAY_WORSE_POINTS,
      );
      const figures = `return ${pts(returnPoints)}, worst drop ${pts(dropPoints)} against the same replay without it`;
      const off = (OPPORTUNITY_RULES_OFF[level] ?? []).find((r) => r.rule === rule);
      const why = off
        ? `Turned off at this level: ${off.evidence}`
        : acted === 0
          ? "Never acted in this history."
          : `Acted ${acted} time${acted === 1 ? "" : "s"}: ${figures}.`;
      return {
        rule,
        label,
        status: off ? "off" : acted === 0 ? "no_difference" : effect,
        returnPoints,
        dropPoints,
        acted,
        why,
      };
    });
    out.push({
      level,
      label: RISK_LEVELS[level].label,
      strategies: {
        rules: summary(withRules),
        rebalance: summary(rebalance),
        hold: summary(hold),
      },
      verdicts,
    });
  }
  const dates = headlines.map((h) => h.date).sort();
  return {
    notAForecast: RULE_REPLAY_NOTE,
    ...span,
    levels: out,
    missing,
    headlines: { count: headlines.length, since: dates[0] ?? null },
    assumptions: {
      startCents: BACKTEST_START_CENTS,
      monthlyAddCents: PRACTICE_MONTHLY_ADD_CENTS,
      tradeCostBps: RULE_REPLAY_TRADE_COST_BPS,
      worsePoints: RULE_REPLAY_WORSE_POINTS,
    },
  };
}

export type LoadedRuleReplays = {
  source: "real" | "sample";
  // "Replay of real history since Jan 4, 2016".
  label: string;
  // Where the prices came from; the sample's own caveat about tax-loss swaps.
  notes: string[];
  replays: RuleReplays;
};

type Options = { client?: PrismaClient; now?: Date };
type History = { source: "real" | "sample"; bars: Record<string, Bar[]>; headlines: Headline[] };

const MAIN = Object.values(PRACTICE_ETFS).map((e) => e.ticker as string);
const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);

// The same choice as the model backtests: stored real history when every model fund has at least
// BACKTEST_MIN_REAL_DAYS shared days; then whatever else is stored (swap partners, the watched
// companies and their headlines). Else the sample market, up to today.
async function replayHistory(to: string, client: PrismaClient): Promise<History> {
  const stored = await storedHistory(MAIN, HISTORY_START, to, { client });
  if (stored && replayDays(stored.bars).length >= BACKTEST_MIN_REAL_DAYS) {
    const bars: Record<string, Bar[]> = { ...stored.bars };
    for (const t of [...PRACTICE_UNIVERSE].filter((x) => !MAIN.includes(x))) {
      const more = await storedHistory([t], HISTORY_START, to, { client });
      if (more) bars[t] = more.bars[t];
    }
    const rows = await client.marketNews.findMany({
      where: {
        feed: stored.source,
        kind: "headline",
        date: { gte: dateOf(HISTORY_START), lte: dateOf(to) },
      },
      orderBy: { date: "asc" },
      select: { key: true, ticker: true, date: true, title: true, source: true, url: true },
    });
    const headlines = rows.map((r) => ({
      id: r.key,
      ticker: r.ticker,
      date: r.date.toISOString().slice(0, 10),
      title: r.title,
      source: r.source,
      url: r.url,
    }));
    return { source: "real", bars, headlines };
  }
  const sample = new SampleMarketData();
  const bars: Record<string, Bar[]> = {};
  for (const t of PRACTICE_UNIVERSE) bars[t] = await sample.prices(t, SAMPLE_START, to);
  const headlines = await sample.news(PRACTICE_STOCKS, SAMPLE_START, to);
  return { source: "sample", bars, headlines };
}

// Replays are kept for the same history: a few seconds of work each, and history changes once a
// day.
const kept = new Map<string, RuleReplays | null>();
const KEEP = 8;

export async function loadRuleReplays(
  { client = defaultClient, now = new Date() }: Options = {},
  levels: readonly RiskLevel[] = LEVELS,
): Promise<LoadedRuleReplays | null> {
  const to = now.toISOString().slice(0, 10);
  const h = await replayHistory(to, client);
  const fingerprint = Object.keys(h.bars)
    .sort()
    .map(
      (t) => `${t}:${h.bars[t].length}:${h.bars[t].at(-1)?.date}:${h.bars[t].at(-1)?.closeCents}`,
    )
    .join(",");
  const key = `${h.source}|${fingerprint}|${h.headlines.length}|${levels.join("")}`;
  if (!kept.has(key)) {
    if (kept.size >= KEEP) kept.delete(kept.keys().next().value!);
    kept.set(key, ruleReplays(h.bars, h.headlines, levels));
  }
  const replays = kept.get(key);
  if (!replays) return null;
  return {
    source: h.source,
    label: `Replay of ${h.source} history since ${longDate(replays.from)}`,
    notes:
      h.source === "real" ? [REAL_HISTORY_NOTE] : [SAMPLE_HISTORY_NOTE, RULE_REPLAY_SAMPLE_NOTE],
    replays,
  };
}

// For one person: only in demo advice mode (spec step 98); real accounts get none.
export async function ruleReplaysFor(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
  levels: readonly RiskLevel[] = LEVELS,
): Promise<{ advice: false } | { advice: true; data: LoadedRuleReplays | null }> {
  if (!(await adviceMode(userId, { client }))) return { advice: false };
  return { advice: true, data: await loadRuleReplays({ client, now }, levels) };
}
