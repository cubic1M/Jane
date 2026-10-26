import {
  AGENT_FOLDS,
  AGENT_INTERVALS,
  AGENT_MARKETS,
  AGENT_MIN_DSR,
  AGENT_TRAIN_SHARE,
  type AgentInterval,
  type AgentMarketId,
} from "@/config/trading-agent";
import type { GroupResult, StrategyResult, Verdict } from "./harness";
import { CALENDAR_RULES } from "./policies";

// The intraday replay written up (docs/backtests/intraday.md) and kept for the app
// (src/config/intraday-agent-evidence.ts), from the harness's groups. Pure.

export type EvidenceRow = {
  key: string;
  label: string;
  // The setting the last fold used: what the live agent runs.
  param: number;
  cagr: number;
  maxDrawdown: number;
  sharpe: number;
  winRate: number | null;
  tradesPerYear: number;
  holdCagr: number;
  dsr: number;
  verdict: Verdict;
};

export type EvidenceGroup = {
  market: AgentMarketId;
  interval: AgentInterval;
  source: string;
  from: string;
  to: string;
  trials: number;
  rows: EvidenceRow[];
};

const pct = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n * 1000) / 10).toFixed(1)}%`;
const num = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace("-", "−");
const day = (iso: string) => iso.slice(0, 10);

export const VERDICT_WORDS: Readonly<Record<Verdict, string>> = {
  beats_hold: "Beat holding, after the haircut",
  behind_hold: "Made less than holding (or not clearly more)",
  loses_money: "Lost money",
};

export function evidenceOf(g: GroupResult, source: string): EvidenceGroup {
  return {
    market: g.market as AgentMarketId,
    interval: g.interval as AgentInterval,
    source,
    from: day(g.from),
    to: day(g.to),
    trials: g.trials,
    rows: g.results.map((r) => ({
      key: r.key,
      label: r.label,
      param: r.chosen.at(-1) ?? 0,
      cagr: round(r.walk.cagr),
      maxDrawdown: round(r.walk.maxDrawdown),
      sharpe: round(r.walk.sharpe),
      winRate: r.walk.winRate === null ? null : round(r.walk.winRate),
      tradesPerYear: Math.round(r.walk.tradesPerYear),
      holdCagr: round(r.hold.cagr),
      dsr: round(r.dsr),
      verdict: r.verdict,
    })),
  };
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

function row(r: StrategyResult): string {
  const w = r.walk;
  return `| ${r.label} | ${r.chosen.join(", ")} | ${pct(w.cagr)} | ${pct(w.maxDrawdown)} | ${num(w.sharpe)} | ${w.winRate === null ? "–" : pct(w.winRate)} | ${Math.round(w.tradesPerYear)} | ${num(w.turnover)}× | ${pct(r.excessCagr)} | ${Math.round(r.dsr * 100)}% | ${VERDICT_WORDS[r.verdict]} |`;
}

export function intradayMarkdown(
  groups: readonly { group: GroupResult; source: string }[],
  { generatedOn, notes = [] }: { generatedOn: string; notes?: readonly string[] },
): string {
  const lines: string[] = [];
  const all = groups.flatMap((g) => g.group.results);
  const count = (v: Verdict) => all.filter((r) => r.verdict === v).length;
  lines.push(
    "# The 24-hour agent: every strategy at 15 minutes and 1 hour",
    "",
    `Generated ${generatedOn} by \`src/lib/trading-agent/intraday-research.cli.test.ts\` (\`INTRADAY_AGENT=all\`). A replay of past bars, not a forecast: future results will be different. Practice money and demo advice only; no order was ever sent anywhere.`,
    "",
    "## The short answer",
    "",
    `${all.length} strategy runs (each strategy, market and interval). **${count("beats_hold")} beat just holding after the haircut; ${count("behind_hold")} made money but less than holding (or not clearly more); ${count("loses_money")} lost money.**`,
    "",
    ...notes,
    ...(notes.length > 0 ? [""] : []),
    "## How it was run",
    "",
    "- **The same loop as the live agent** (`src/planning/trading-agent/engine.ts`): each rule decides at a bar's close from that bar and the ones before it, and the trade fills at the **next bar's open**. Nothing reads a later bar (tested: a run cut short trades exactly like the full run up to the cut).",
    `- **Costs on every fill:** crypto ${AGENT_MARKETS.crypto.feeBps} bps fee (Alpaca's taker fee) plus ${AGENT_MARKETS.crypto.halfSpreadBps} bp half spread and ${AGENT_MARKETS.crypto.slippageBps} bps slippage; US funds no commission, ${AGENT_MARKETS.stocks.halfSpreadBps} bp half spread and ${AGENT_MARKETS.stocks.slippageBps} bps slippage. Just holding pays them once.`,
    "- **Nights and weekends:** US funds trade 9:30 to 4 New York time only. A trade decided at the last bar of the day fills at the next morning's open, so the overnight and weekend gap is in the price. Crypto runs around the clock.",
    '- **The catalog\'s rules, bar by bar:** every rule in `src/config/strategy-catalog.ts` runs unchanged, with each bar as one trading day of a made-up calendar (`src/planning/trading-agent/clock.ts`). A 200-day average becomes a 200-bar average, and "each month" every 21 or so bars. Rules over SPY and bills alone are also pointed at QQQ, and at bitcoin and ether with plain cash as the bills. The multi-fund rules run on their own funds in market hours. The crypto rules (`src/config/crypto-strategies.ts`) run on bitcoin and ether.',
    `- **Left out:** ${CALENDAR_RULES.join(", ")}. They are calendar rules, and a made-up calendar means nothing to them; their daily results are in strategy-results.md.`,
    `- **Walk-forward:** the first ${Math.round(AGENT_TRAIN_SHARE * 100)}% of bars only train. The rest is cut into ${AGENT_FOLDS} folds, each scored with the setting the bars before it chose by Sharpe ratio (\"Settings\" lists them in order). Every figure below is from those out-of-sample folds.`,
    `- **The haircut:** the catalog's, the deflated Sharpe ratio of each strategy's bar returns over holding's, against the best of every trial run (the count is in each table). A strategy beats holding only when that is at least ${Math.round(AGENT_MIN_DSR * 100)}% and its growth is higher too.`,
    '- **Figures:** CAGR is yearly growth; worst drop is peak to trough; Sharpe is yearly, from bar returns with no cash hurdle; win rate is the share of sells above what was paid, costs included; trades a year; turnover is what changed hands in a year over the average value; "vs hold" is CAGR minus just holding\'s.',
    "",
  );
  for (const { group: g, source } of groups) {
    const m = AGENT_MARKETS[g.market as AgentMarketId];
    lines.push(
      `## ${m.label}, every ${AGENT_INTERVALS[g.interval as AgentInterval].label}`,
      "",
      `Bars: ${source}. Scored ${day(g.from)} to ${day(g.to)} (${g.bars.toLocaleString("en-US")} bars), ${g.trials} trials in the haircut. **Just holding ${m.hold.replace("/USD", "")}: ${pct(g.hold.cagr)} a year, worst drop ${pct(g.hold.maxDrawdown)}, Sharpe ${num(g.hold.sharpe)}.**`,
      "",
      "| Strategy | Settings | CAGR | Worst drop | Sharpe | Win rate | Trades/yr | Turnover/yr | vs hold | DSR | Verdict |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...g.results.map(row),
      "",
    );
  }
  return lines.join("\n");
}

// The evidence as a module for the app (src/config/intraday-agent-evidence.ts).
export function evidenceTs(groups: readonly EvidenceGroup[], generatedOn: string): string {
  return `import type { EvidenceGroup } from "@/planning/trading-agent/report";

// The 24-hour agent's replay (docs/backtests/intraday.md), generated ${generatedOn} by
// src/lib/trading-agent/intraday-research.cli.test.ts. Each strategy's out-of-sample figures by
// market and interval, and the setting the live agent runs. Do not edit by hand.

export const INTRADAY_AGENT_EVIDENCE: readonly EvidenceGroup[] = ${JSON.stringify(groups, null, 2)};
`;
}
