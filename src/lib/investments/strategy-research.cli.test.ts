import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { strategyTickers } from "@/config/portfolios";
import { RISK_BUDGETS, STRATEGY_LABELS, type StrategyId } from "@/config/strategies";
import { AlpacaMarketData } from "@/lib/market/alpaca";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import type { Bar } from "@/lib/market/types";
import { alignUniverse, type Metrics } from "@/planning/strategies/engine";
import { selectForLevel } from "@/planning/strategies/select";

// The strategy research CLI (.github/workflows/strategy-research.yml, and locally): run with
// STRATEGY_RESEARCH set, never in CI's test runs. Modes:
// - fetch: the strategy universe's daily bars into RESEARCH_DIR/bars.json, from Alpaca with
//   ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (RESEARCH_SOURCE=alpaca; the only mode that calls
//   out, and only here) or from the committed keyless fixture (RESEARCH_SOURCE=fixture);
// - level: every strategy for RESEARCH_LEVEL into level-<n>.json;
// - summary: every level-<n>.json into results.json and summary.md;
// - all: the three in turn, for a local round.
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
  });
});
