import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { catalogTickers } from "@/config/strategy-catalog";
import {
  AGENT_INTERVAL_IDS,
  AGENT_INTERVALS,
  AGENT_MARKETS,
  type AgentInterval,
  type AgentMarketId,
} from "@/config/trading-agent";
import { cachedBars } from "@/lib/trading-agent/bar-cache";
import { fetchAgentBars, sourceFor, YAHOO_INTRADAY_DAYS } from "@/lib/trading-agent/bars";
import { timelineOf } from "@/planning/trading-agent/clock";
import { runGroup, type GroupResult } from "@/planning/trading-agent/harness";
import { policiesFor } from "@/planning/trading-agent/policies";
import { evidenceOf, evidenceTs, intradayMarkdown } from "@/planning/trading-agent/report";
import type { AgentBar } from "@/planning/trading-agent/types";

// The 24-hour agent's research run (docs/backtests/intraday.md): run with INTRADAY_AGENT set,
// never in CI's test runs. Modes:
// - fetch: every bar the run needs into RESEARCH_DIR/bars (crypto from Alpaca with no key; US
//   funds from Alpaca with ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY, else Yahoo's keyless
//   chart), kept there so a rerun asks only for newer bars;
// - run: every strategy at 15 minutes and 1 hour on crypto and US funds, walk-forward with the
//   haircut, into RESEARCH_DIR/intraday.md (to commit as docs/backtests/intraday.md),
//   intraday-agent-evidence.ts (src/config/intraday-agent-evidence.ts) and intraday-agent.json;
// - all: both.
// INTRADAY_MARKETS ("crypto,stocks") and INTRADAY_INTERVALS ("15m,1h") narrow it. Keys are read
// from the environment and never written or printed. Prices only: no order is ever sent.

const MODE = process.env.INTRADAY_AGENT;
const DIR = process.env.RESEARCH_DIR ?? "research";
const BARS = join(DIR, "bars");
const NOW = new Date(process.env.INTRADAY_TO ?? Date.now());
const TO = new Date(Math.floor(NOW.getTime() / 3_600_000) * 3_600_000).toISOString();
// Crypto bars start on Alpaca in 2021; Alpaca's stock bars (the SIP feed) go back years.
const FROM: Readonly<Record<AgentMarketId, string>> = {
  crypto: process.env.INTRADAY_CRYPTO_FROM ?? "2021-01-01T00:00:00.000Z",
  stocks: process.env.INTRADAY_STOCKS_FROM ?? "2019-01-01T00:00:00.000Z",
};
const MARKETS = (process.env.INTRADAY_MARKETS ?? "crypto,stocks").split(",") as AgentMarketId[];
const INTERVALS = (process.env.INTRADAY_INTERVALS ?? AGENT_INTERVAL_IDS.join(",")).split(
  ",",
) as AgentInterval[];

const tickersOf = (market: AgentMarketId) =>
  market === "crypto"
    ? [...AGENT_MARKETS.crypto.assets]
    : [
        ...new Set([
          ...AGENT_MARKETS.stocks.assets,
          AGENT_MARKETS.stocks.cash,
          ...catalogTickers(),
        ]),
      ].sort();

function fromFor(market: AgentMarketId, interval: AgentInterval, source: string) {
  if (source !== "yahoo") return FROM[market];
  // Yahoo keeps only so much intraday history.
  return new Date(NOW.getTime() - YAHOO_INTRADAY_DAYS[interval] * 86_400_000).toISOString();
}

async function barsFor(market: AgentMarketId, interval: AgentInterval) {
  const out: Record<string, AgentBar[]> = {};
  let source = "";
  for (const ticker of tickersOf(market)) {
    const src = sourceFor(ticker);
    source = src;
    const from = fromFor(market, interval, src);
    try {
      const { bars, fetched } = await cachedBars(
        BARS,
        src,
        ticker,
        interval,
        from,
        TO,
        async (a, b) => (await fetchAgentBars(ticker, a, b, interval)).bars,
      );
      out[ticker] = bars;
      console.log(
        `${market} ${interval} ${ticker}: ${bars.length} bars (${fetched} fetched, ${src})`,
      );
    } catch (error) {
      console.log(`${market} ${interval} ${ticker}: no bars (${String(error)})`);
    }
  }
  return { bars: out, source };
}

const SOURCE_WORDS: Readonly<Record<string, string>> = {
  "alpaca-crypto": "Alpaca's crypto bars (no key needed)",
  alpaca:
    "Alpaca's stock bars (SIP feed, split- and dividend-adjusted), 15-minute bars joined into hours from the 9:30 open",
  yahoo:
    "Yahoo Finance's keyless intraday chart (not adjusted for dividends; about two years of hourly bars and sixty days of 15-minute bars)",
};

describe.runIf(MODE)("the 24-hour agent's research run", () => {
  it(
    `runs ${MODE}`,
    async () => {
      mkdirSync(DIR, { recursive: true });
      const loaded: {
        market: AgentMarketId;
        interval: AgentInterval;
        bars: Record<string, AgentBar[]>;
        source: string;
      }[] = [];
      for (const market of MARKETS)
        for (const interval of INTERVALS)
          loaded.push({ market, interval, ...(await barsFor(market, interval)) });
      if (MODE === "fetch") return;
      // The haircut counts every trial in the run, not only a group's own.
      const setups = loaded.map((l) => {
        const m = AGENT_MARKETS[l.market];
        const master = l.market === "crypto" ? m.hold : "SPY";
        const tl = timelineOf(l.bars, master, m.session);
        const policies = policiesFor(l.market).filter((p) =>
          p.tickers.every((t) => t === "USD" || tl.close[t]?.some((c) => c > 0)),
        );
        return { ...l, m, tl, policies, trials: policies.reduce((a, p) => a + p.grid.length, 0) };
      });
      const total = setups.reduce((a, s) => a + s.trials, 0);
      const groups: { group: GroupResult; source: string }[] = [];
      for (const s of setups) {
        const started = Date.now();
        const group = runGroup(
          s.market,
          s.interval,
          s.policies,
          s.tl,
          s.m,
          s.m.cash,
          s.m.hold,
          AGENT_INTERVALS[s.interval].minutes,
          { extraTrials: total - s.trials },
        );
        console.log(
          `${s.market} ${s.interval}: ${group ? group.results.length : 0} strategies on ${s.tl.times.length} bars in ${Math.round((Date.now() - started) / 1000)}s`,
        );
        if (group) groups.push({ group, source: SOURCE_WORDS[s.source] ?? s.source });
      }
      const generatedOn = NOW.toISOString().slice(0, 10);
      writeFileSync(join(DIR, "intraday.md"), intradayMarkdown(groups, { generatedOn }));
      writeFileSync(
        join(DIR, "intraday-agent-evidence.ts"),
        evidenceTs(
          groups.map((g) => evidenceOf(g.group, g.source)),
          generatedOn,
        ),
      );
      writeFileSync(join(DIR, "intraday-agent.json"), JSON.stringify(groups, null, 1));
    },
    6 * 3_600_000,
  );
});
