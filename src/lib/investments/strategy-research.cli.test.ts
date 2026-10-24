import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { strategyTickers } from "@/config/portfolios";
import { RISK_BUDGETS, STRATEGY_LABELS, type StrategyId } from "@/config/strategies";
import {
  INTRADAY_RULE_IDS,
  INTRADAY_RULES,
  INTRADAY_SLIPPAGE,
  INTRADAY_TICKER,
  INTRADAY_TIMEFRAME,
  INTRADAY_TRAIN_END,
} from "@/config/intraday-strategies";
import { AlpacaMarketData } from "@/lib/market/alpaca";
import { fetchIntraday } from "@/lib/market/alpaca-intraday";
import { catalogTickers } from "@/config/strategy-catalog";
import {
  CRYPTO_STRATEGIES,
  CRYPTO_STRATEGY_IDS,
  CRYPTO_TRAIN_END,
} from "@/config/crypto-strategies";
import { alignCrypto, cryptoResult } from "@/planning/crypto-strategies";
import { alignCatalog, runCatalog } from "@/planning/catalog/engine";
import { regimeReport, regimesMarkdown } from "@/planning/catalog/regimes";
import { sensitivity, sensitivityMarkdown } from "@/planning/catalog/sensitivity";
import { fetchYahooDaily, yahooBars } from "@/lib/market/yahoo";
import { evidenceModule, resultsMarkdown } from "@/planning/catalog/report";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import type { Bar } from "@/lib/market/types";
import { alignUniverse, type Metrics } from "@/planning/strategies/engine";
import { intradayResult, sessionsOf, type IntradayMetrics } from "@/planning/intraday";
import { selectForLevel } from "@/planning/strategies/select";

// The strategy research CLI (.github/workflows/strategy-research.yml, and locally): run with
// STRATEGY_RESEARCH set, never in CI's test runs. Modes:
// - fetch: the strategy universe's daily bars into RESEARCH_DIR/bars.json, from Alpaca with
//   ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (RESEARCH_SOURCE=alpaca; the only mode that calls
//   out, and only here) or from the committed keyless fixture (RESEARCH_SOURCE=fixture);
// - level: every strategy for RESEARCH_LEVEL into level-<n>.json;
// - summary: every level-<n>.json into results.json and summary.md;
// - all: the three in turn, for a local round;
// - intraday: INTRADAY_TICKER's 5-minute bars from Alpaca, every day-trading rule walk-forward
//   (src/planning/intraday.ts), into intraday-evidence.ts (to commit as
//   src/config/intraday-evidence.ts) and intraday-summary.md;
// - catalog: every catalog strategy's funds' daily closes (and SPY's daily bars) from Alpaca,
//   the whole catalog replayed (src/planning/catalog/), into strategy-results.md (to commit as
//   docs/backtests/strategy-results.md), catalog-evidence.ts (src/config/catalog-evidence.ts) and
//   catalog-results.json;
// - crypto: bitcoin's and ether's daily bars from Alpaca's crypto feed, the three crypto rules
//   replayed walk-forward (src/planning/crypto-strategies.ts), into crypto-summary.md and
//   crypto-results.json;
// - regimes: every catalog fund's adjusted daily closes from Yahoo Finance's keyless chart, from
//   2005 (each younger fund spliced with an older look-alike), every strategy at its middle setting
//   through 2008, the 2020 crash and 2022 (src/planning/catalog/regimes.ts), into regimes.md.
// Keys are read from the environment and never written or printed. Practice research only.

const MODE = process.env.STRATEGY_RESEARCH;
const DIR = process.env.RESEARCH_DIR ?? "research";
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;

type BarsFile = { source: string; fetchedAt: string; bars: Record<string, Bar[]> };

async function fetchBars(): Promise<BarsFile> {
  const source = process.env.RESEARCH_SOURCE ?? "fixture";
  const tickers = strategyTickers();
  if (source === "fixture") {
    const all = realFixtureBars();
    return {
      source: "fixture",
      fetchedAt: new Date().toISOString(),
      bars: Object.fromEntries(tickers.map((t) => [t, all[t] ?? []])),
    };
  }
  const id = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!id || !secret) throw new Error("Alpaca secrets not set");
  const feed = process.env.RESEARCH_FEED ?? process.env.ALPACA_DATA_FEED ?? "iex";
  const alpaca = new AlpacaMarketData({ id, secret }, undefined, undefined, feed);
  const from = process.env.RESEARCH_FROM ?? "2016-01-01";
  // To yesterday: the free plan's SIP feed refuses the latest 15 minutes.
  const to = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const bars: Record<string, Bar[]> = {};
  for (const t of tickers) {
    bars[t] = await alpaca.prices(t, from, to);
    if (bars[t].length === 0) throw new Error(`Alpaca (${feed}) gave no bars for ${t}.`);
  }
  return { source: `alpaca (${feed})`, fetchedAt: new Date().toISOString(), bars };
}

type LevelFile = {
  level: RiskLevel;
  source: string;
  from: string;
  to: string;
  days: number;
  chosen: { key: string; id: StrategyId; why: string; train: Metrics; test: Metrics };
  baseline: { train: Metrics; test: Metrics };
  byStartYear: {
    startYear: number;
    pick: string;
    passed: boolean;
    results: { key: string; train: Metrics; test: Metrics }[];
  }[];
};

function runLevel(file: BarsFile, level: RiskLevel): LevelFile {
  const data = alignUniverse(file.bars);
  if (!data) throw new Error("Not every strategy fund has bars.");
  const s = selectForLevel(data, level);
  if (!s) throw new Error(`Level ${level} could not be evaluated.`);
  return {
    level,
    source: file.source,
    from: data.dates[0],
    to: data.dates[data.dates.length - 1],
    days: data.dates.length,
    chosen: { key: s.chosenKey, id: s.chosen.id, why: s.why, train: s.train, test: s.test },
    baseline: s.baseline,
    byStartYear: s.byStartYear.map((y) => ({
      startYear: y.startYear,
      pick: y.pick,
      passed: y.passed,
      results: y.results.map((r) => ({ key: r.key, train: r.train, test: r.test })),
    })),
  };
}

function summarise(levels: LevelFile[]): string {
  const first = levels[0];
  const lines = [
    `# Strategy research: ${first.source}, ${first.from} to ${first.to} (${first.days} trading days)`,
    "",
    "A replay of the past, not a forecast. Chosen on the years to 2021, scored on the years after; kept only if it beats the level's mix there by the margin, from every start year.",
    "",
    "| Level | Budget (drop / volatility) | Follows | Later years: chosen (drop, a year, Sortino) | Later years: the mix | Picks by start year |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const l of levels) {
    const b = RISK_BUDGETS[l.level];
    const c = l.chosen.test;
    const m = l.baseline.test;
    lines.push(
      `| ${RISK_LEVELS[l.level].label} | ${pct(b.maxDrawdown)} / ${pct(b.volCap)} | ${STRATEGY_LABELS[l.chosen.id]} \`${l.chosen.key}\` | ${pct(c.maxDrawdown)}, ${pct(c.cagr)}, ${c.sortino.toFixed(2)} | ${pct(m.maxDrawdown)}, ${pct(m.cagr)}, ${m.sortino.toFixed(2)} | ${l.byStartYear.map((y) => `${y.startYear}: \`${y.pick}\`${y.passed ? " ✓" : " ✗"}`).join("; ")} |`,
    );
  }
  for (const l of levels) {
    lines.push("", `## ${RISK_LEVELS[l.level].label}`, "", l.chosen.why, "");
    lines.push(
      "| Candidate | Train: a year | Train: drop | Train: Sortino | Later: a year | Later: drop | Later: volatility | Later: Sortino | Turnover |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const r of [...l.byStartYear[0].results].sort((a, b) => b.train.sortino - a.train.sortino))
      lines.push(
        `| \`${r.key}\` | ${pct(r.train.cagr)} | ${pct(r.train.maxDrawdown)} | ${r.train.sortino.toFixed(2)} | ${pct(r.test.cagr)} | ${pct(r.test.maxDrawdown)} | ${pct(r.test.vol)} | ${r.test.sortino.toFixed(2)} | ${r.test.turnover.toFixed(2)}× |`,
      );
  }
  return lines.join("\n") + "\n";
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const period = (m: IntradayMetrics) => ({
  from: m.from,
  to: m.to,
  sessions: m.sessions,
  trades: m.trades,
  winRate: r4(m.winRate),
  averageTrade: r4(m.averageTrade),
  cagr: r4(m.cagr),
  maxDrawdown: r4(m.maxDrawdown),
  vol: r4(m.vol),
  sortino: r4(m.sortino),
});

async function runIntraday() {
  const id = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!id || !secret) throw new Error("Alpaca secrets not set");
  const feed = process.env.RESEARCH_FEED ?? "sip";
  const from = process.env.RESEARCH_FROM ?? "2016-01-01";
  const to = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const bars = await fetchIntraday({ id, secret }, INTRADAY_TICKER, from, to, {
    timeframe: INTRADAY_TIMEFRAME,
    feed,
  });
  const sessions = sessionsOf(bars);
  if (sessions.length < 500) throw new Error(`Only ${sessions.length} sessions of bars.`);
  console.log(
    `${INTRADAY_TICKER}: ${bars.length} bars, ${sessions.length} sessions, ${sessions[0].date} to ${sessions.at(-1)!.date}`,
  );
  const results = INTRADAY_RULE_IDS.map((rule) => intradayResult(sessions, rule)).filter(
    (r) => r !== null,
  );
  if (results.length !== INTRADAY_RULE_IDS.length) throw new Error("A rule could not be replayed.");
  const source = `Alpaca ${feed.toUpperCase()} ${INTRADAY_TIMEFRAME} bars for ${INTRADAY_TICKER}, ${sessions[0].date} to ${sessions.at(-1)!.date}`;
  const rows = results.map(
    (r) =>
      `  ${r.id}: ${JSON.stringify({ param: r.param, train: period(r.train), later: period(r.later), holdLater: period(r.holdLater), beatsHolding: r.beatsHolding, curve: r.curve })},`,
  );
  writeFileSync(
    join(DIR, "intraday-evidence.ts"),
    `import type { IntradayRuleId } from "@/config/intraday-strategies";

// Each day-trading rule on real 5-minute bars (src/planning/intraday.ts): its setting chosen on
// the sessions to INTRADAY_TRAIN_END, then its result on the later sessions against holding the
// fund over the same days, after slippage both ways, and its curve over those sessions from 100.
// Written by the strategy research workflow (kind: intraday), whose bars are too many to commit;
// src/planning/intraday.test.ts checks the rules themselves. A replay of the past, not a
// forecast. Fractions throughout.

export type IntradayPeriod = {
  from: string;
  to: string;
  sessions: number;
  trades: number;
  winRate: number;
  averageTrade: number;
  cagr: number;
  maxDrawdown: number;
  vol: number;
  sortino: number;
};
export type IntradayRecord = {
  param: number;
  train: IntradayPeriod;
  later: IntradayPeriod;
  holdLater: IntradayPeriod;
  beatsHolding: boolean;
  curve: number[];
};

export const INTRADAY_EVIDENCE_SOURCE = ${JSON.stringify(source)};

export const INTRADAY_EVIDENCE: Readonly<Record<IntradayRuleId, IntradayRecord>> = {
${rows.join("\n")}
};
`,
  );
  const lines = [
    `# Day-trading research: ${source}`,
    "",
    `Chosen on the sessions to ${INTRADAY_TRAIN_END} by Sortino, scored on the later ones, ${(INTRADAY_SLIPPAGE * 100).toFixed(2)}% slippage each way. A replay of the past, not a forecast.`,
    "",
    "| Rule | Setting | Train: a year | Train: drop | Later: trades | Later: win rate | Later: a year | Later: drop | Later: Sortino | Holding: a year | Holding: drop | Holding: Sortino |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${INTRADAY_RULES[r.id].label} | ${r.param} | ${pct(r.train.cagr)} | ${pct(r.train.maxDrawdown)} | ${r.later.trades} | ${pct(r.later.winRate)} | ${pct(r.later.cagr)} | ${pct(r.later.maxDrawdown)} | ${r.later.sortino.toFixed(2)} | ${pct(r.holdLater.cagr)} | ${pct(r.holdLater.maxDrawdown)} | ${r.holdLater.sortino.toFixed(2)} |`,
    ),
  ];
  writeFileSync(join(DIR, "intraday-summary.md"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}

async function runCatalogResearch() {
  const id = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!id || !secret) throw new Error("Alpaca secrets not set");
  const feed = process.env.RESEARCH_FEED ?? "sip";
  const from = process.env.RESEARCH_FROM ?? "2016-01-01";
  const to = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const alpaca = new AlpacaMarketData({ id, secret }, undefined, undefined, feed);
  const bars: Record<string, Bar[]> = {};
  for (const t of catalogTickers()) {
    bars[t] = await alpaca.prices(t, from, to);
    console.log(`${t}: ${bars[t].length} bars from ${bars[t][0]?.date ?? "none"}`);
  }
  const spy = (
    await fetchIntraday({ id, secret }, "SPY", from, to, { timeframe: "1Day", feed })
  ).map((b) => ({ date: b.t.slice(0, 10), o: b.o, h: b.h, l: b.l, c: b.c }));
  const u = alignCatalog(bars, spy);
  if (!u) throw new Error("No VTI bars to align on.");
  const { results, trials } = runCatalog(u);
  const meta = {
    source: `Alpaca ${feed.toUpperCase()} daily closes`,
    from: u.dates[0],
    to: u.dates[u.dates.length - 1],
    trials,
  };
  writeFileSync(join(DIR, "catalog-results.json"), JSON.stringify({ meta, results }, null, 1));
  writeFileSync(join(DIR, "strategy-results.md"), resultsMarkdown(results, meta));
  writeFileSync(join(DIR, "catalog-evidence.ts"), evidenceModule(results, meta));
  writeFileSync(
    join(DIR, "sensitivity.md"),
    sensitivityMarkdown(sensitivity(u), `${meta.source}, ${meta.from} to ${meta.to}`),
  );
  for (const r of results.filter((x) => x.recommendable))
    console.log(`recommendable at ${r.level}: ${r.id}`);
  console.log(`${results.length} results, ${trials} trials`);
}

async function runCryptoResearch() {
  const id = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!id || !secret) throw new Error("Alpaca secrets not set");
  const from = process.env.RESEARCH_FROM ?? "2016-01-01";
  const to = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const alpaca = new AlpacaMarketData({ id, secret });
  const bars = {
    BTC: await alpaca.prices("BTCUSD", from, to),
    ETH: await alpaca.prices("ETHUSD", from, to),
  };
  for (const [t, b] of Object.entries(bars))
    console.log(`${t}: ${b.length} bars, ${b[0]?.date ?? "none"} to ${b.at(-1)?.date ?? "none"}`);
  const u = alignCrypto(bars);
  if (!u) throw new Error("No crypto bars.");
  const results = CRYPTO_STRATEGY_IDS.map((sid) => ({ id: sid, r: cryptoResult(u, sid) }));
  const source = `Alpaca crypto daily bars for BTC/USD and ETH/USD, ${u.dates[0]} to ${u.dates.at(-1)}`;
  const lines = [
    `# Crypto rules on ${source}`,
    "",
    `Chosen on the days to ${CRYPTO_TRAIN_END}, scored after, against simply holding, after fees and slippage. A replay of the past, not a forecast. ${u.dates[0] > CRYPTO_TRAIN_END.slice(0, 4) + "-01-01" ? "The feed starts after the training years begin, so the choice rests on fewer years." : ""}`,
    "",
    "| Rule | Setting | Later: a year | Later: worst drop | Later: Sortino | Holding: a year | Holding: worst drop | Holding: Sortino | More return for its risk than holding |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map(({ id: sid, r }) =>
      r
        ? `| ${CRYPTO_STRATEGIES[sid].label} | ${r.param} | ${pct(r.later.cagr)} | ${pct(r.later.maxDrawdown)} | ${r.later.sortino.toFixed(2)} | ${pct(r.holdLater.cagr)} | ${pct(r.holdLater.maxDrawdown)} | ${r.holdLater.sortino.toFixed(2)} | ${r.beatsHolding ? "yes" : "no"} |`
        : `| ${CRYPTO_STRATEGIES[sid].label} | – | not enough history | | | | | | |`,
    ),
  ];
  writeFileSync(join(DIR, "crypto-summary.md"), lines.join("\n") + "\n");
  writeFileSync(join(DIR, "crypto-results.json"), JSON.stringify({ source, results }, null, 1));
  console.log(lines.join("\n"));
}

// A fund's closes, with an older fund's returns before its first day (scaled to meet it).
function splice(newer: Bar[], older: Bar[]): Bar[] {
  if (newer.length === 0) return older;
  const first = newer[0];
  const at = older.find((b) => b.date === first.date);
  if (!at) return newer;
  const scale = first.closeCents / at.closeCents;
  return [
    ...older
      .filter((b) => b.date < first.date)
      .map((b) => ({ date: b.date, closeCents: Math.round(b.closeCents * scale) })),
    ...newer,
  ];
}

async function runRegimes() {
  const from = process.env.RESEARCH_FROM ?? "2005-01-01";
  const to = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const bars: Record<string, Bar[]> = {};
  let spy: { date: string; o: number; h: number; l: number; c: number }[] = [];
  for (const t of [...new Set([...catalogTickers(), "VEU"])]) {
    try {
      const days = await fetchYahooDaily(t, from, to);
      bars[t] = yahooBars(days);
      if (t === "SPY") spy = days.map((d) => ({ date: d.date, o: d.o, h: d.h, l: d.l, c: d.c }));
      console.log(`${t}: ${bars[t].length} days from ${bars[t][0]?.date ?? "none"}`);
    } catch (error) {
      console.log(`${t}: none (${String(error)})`);
      bars[t] = [];
    }
  }
  // Younger funds read through an older look-alike before they began (labelled in the source).
  const SPLICES: [string, string][] = [
    ["VEU", "EFA"],
    ["VXUS", "VEU"],
    ["BIL", "SHY"],
    ["BND", "AGG"],
    ["HYG", "LQD"],
    ["VWO", "EEM"],
    ["SCZ", "EFA"],
    ["GSG", "DBC"],
    ["REM", "VNQ"],
    ["DLS", "EFA"],
    ["DGS", "EEM"],
  ];
  for (const [young, old] of SPLICES) bars[young] = splice(bars[young] ?? [], bars[old] ?? []);
  const u = alignCatalog(bars, spy);
  if (!u) throw new Error("No VTI history.");
  const { results } = runCatalog(u);
  const watch = [...new Set(results.filter((r) => r.watch || r.recommendable).map((r) => r.id))];
  const source = `Yahoo Finance adjusted daily closes, ${u.dates[0]} to ${u.dates.at(-1)}, each younger fund read through an older look-alike before it began (${SPLICES.map(([y, o]) => `${y} through ${o}`).join(", ")})`;
  const md = regimesMarkdown(regimeReport(u), source, watch);
  writeFileSync(join(DIR, "regimes.md"), md);
  writeFileSync(
    join(DIR, "regimes.json"),
    JSON.stringify({ source, watch, rows: regimeReport(u) }, null, 1),
  );
  console.log(md.slice(0, 4000));
}

const readBars = () => JSON.parse(readFileSync(join(DIR, "bars.json"), "utf8")) as BarsFile;
const writeLevel = (l: LevelFile) =>
  writeFileSync(join(DIR, `level-${l.level}.json`), JSON.stringify(l));
function writeSummary() {
  const levels = readdirSync(DIR)
    .filter((f) => /^level-\d\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as LevelFile)
    .sort((a, b) => a.level - b.level);
  writeFileSync(join(DIR, "results.json"), JSON.stringify(levels, null, 1));
  writeFileSync(join(DIR, "summary.md"), summarise(levels));
  for (const l of levels) console.log(`${RISK_LEVELS[l.level].label}: ${l.chosen.key}`);
}

describe.runIf(MODE)("strategy research", () => {
  it(`runs: ${MODE}`, { timeout: 3_600_000 }, async () => {
    mkdirSync(DIR, { recursive: true });
    if (MODE === "fetch" || MODE === "all") {
      const file = await fetchBars();
      writeFileSync(join(DIR, "bars.json"), JSON.stringify(file));
      for (const [t, b] of Object.entries(file.bars))
        console.log(
          `${t}: ${b.length} bars, ${b[0]?.date ?? "none"} to ${b.at(-1)?.date ?? "none"}`,
        );
    }
    if (MODE === "level")
      writeLevel(runLevel(readBars(), Number(process.env.RESEARCH_LEVEL) as RiskLevel));
    if (MODE === "all") {
      const file = readBars();
      for (const level of [1, 2, 3, 4, 5] as const) writeLevel(runLevel(file, level));
    }
    if (MODE === "summary" || MODE === "all") writeSummary();
    if (MODE === "intraday") await runIntraday();
    if (MODE === "catalog") await runCatalogResearch();
    if (MODE === "crypto") await runCryptoResearch();
    if (MODE === "regimes") await runRegimes();
  });
});
