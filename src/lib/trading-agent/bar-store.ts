import type { AgentInterval } from "@/config/trading-agent";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import type { AgentBar } from "@/planning/trading-agent/types";
import { fetchAgentBars, sourceFor } from "./bars";
import { sampleAgentBars } from "./sample-bars";

// Where the live agent's bars come from (src/lib/trading-agent/agent.ts), cached in market_bars so
// a catch-up asks the source only for the part of the range it hasn't kept (a rerun is free). Real
// bars in production (crypto from Alpaca without a key; funds from Alpaca with its keys, else
// Yahoo); the sample bars (src/lib/trading-agent/sample-bars.ts) elsewhere, or when
// PAPER_SAMPLE_PRICES=1 (the e2e tests), and never presented as real. Prices only.

export type AgentFeed = {
  name: string;
  real: boolean;
  bars(ticker: string, from: string, to: string, interval: AgentInterval): Promise<AgentBar[]>;
};

export const sampleFeed: AgentFeed = {
  name: "sample",
  real: false,
  bars: async (ticker, from, to, interval) => sampleAgentBars(ticker, from, to, interval),
};

const iso = (d: Date) => d.toISOString();

// Real bars through the cache. Callers ask only for closed bars (`to` a bar's length before now).
export function liveFeed(
  client: PrismaClient = defaultClient,
  env: Record<string, string | undefined> = process.env,
  fetchRange: typeof fetchAgentBars = fetchAgentBars,
): AgentFeed {
  return {
    name: "live",
    real: true,
    async bars(ticker, from, to, interval) {
      const source = sourceFor(ticker, env);
      const where = { source, ticker, interval };
      const kept = await client.marketBarRange.findUnique({
        where: { source_ticker_interval: where },
      });
      const ranges: [string, string][] = [];
      if (!kept) ranges.push([from, to]);
      else {
        if (from < iso(kept.fromAt)) ranges.push([from, iso(kept.fromAt)]);
        if (to > iso(kept.toAt)) ranges.push([iso(kept.toAt), to]);
      }
      let newest = kept ? iso(kept.toAt) : null;
      for (const [a, b] of ranges) {
        const got = (await fetchRange(ticker, a, b, interval, { env })).bars;
        const last = got.at(-1)?.t;
        if (last && (!newest || last > newest)) newest = last;
        if (got.length > 0)
          await client.marketBar.createMany({
            data: got.map((x) => ({
              ...where,
              t: new Date(x.t),
              o: x.o,
              h: x.h,
              l: x.l,
              c: x.c,
              v: x.v,
            })),
            skipDuplicates: true,
          });
      }
      if (ranges.length > 0) {
        const fromAt = new Date(kept && iso(kept.fromAt) < from ? kept.fromAt : from);
        // Kept only to the newest bar received: a bar the source publishes a moment late is asked
        // for again next time.
        const toAt = new Date(newest ?? from);
        await client.marketBarRange.upsert({
          where: { source_ticker_interval: where },
          create: { ...where, fromAt, toAt },
          update: { fromAt, toAt },
        });
      }
      const rows = await client.marketBar.findMany({
        where: { ...where, t: { gte: new Date(from), lte: new Date(to) } },
        orderBy: { t: "asc" },
        select: { t: true, o: true, h: true, l: true, c: true, v: true },
      });
      return rows.map((r) => ({ ...r, t: iso(r.t) }));
    },
  };
}

export function agentFeed(
  env: Record<string, string | undefined> = process.env,
  client: PrismaClient = defaultClient,
): AgentFeed {
  if (env.PAPER_SAMPLE_PRICES === "1") return sampleFeed;
  if (env.NODE_ENV === "production" || env.AGENT_LIVE_BARS === "1") return liveFeed(client, env);
  return sampleFeed;
}
