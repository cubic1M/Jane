import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentInterval } from "@/config/trading-agent";
import type { AgentBar } from "@/planning/trading-agent/types";

// The research run's bar cache (src/lib/trading-agent/intraday-research.cli.test.ts): each
// ticker's bars at an interval kept in one JSON file under the research folder, with the range
// asked for, so a rerun reads them back and asks the source only for what is newer (or older)
// than what is kept. Never committed; never read by the app (the live agent's cache is the
// market_bars table).

type Cached = { source: string; from: string; to: string; bars: AgentBar[] };

const fileOf = (dir: string, source: string, ticker: string, interval: AgentInterval) =>
  join(dir, `${source}-${ticker.replace(/[^A-Za-z0-9]/g, "-")}-${interval}.json`);

export function readCached(
  dir: string,
  source: string,
  ticker: string,
  interval: AgentInterval,
): Cached | null {
  const file = fileOf(dir, source, ticker, interval);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Cached;
  } catch {
    return null;
  }
}

// Bars kept and fetched merged by time, the newer copy of a bar winning.
export function mergeBars(a: readonly AgentBar[], b: readonly AgentBar[]): AgentBar[] {
  const by = new Map<string, AgentBar>();
  for (const x of a) by.set(x.t, x);
  for (const x of b) by.set(x.t, x);
  return [...by.values()].sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : 0));
}

// The bars from..to, from the cache and the source for any part it doesn't cover.
export async function cachedBars(
  dir: string,
  source: string,
  ticker: string,
  interval: AgentInterval,
  from: string,
  to: string,
  fetchRange: (from: string, to: string) => Promise<AgentBar[]>,
): Promise<{ bars: AgentBar[]; fetched: number }> {
  mkdirSync(dir, { recursive: true });
  const kept = readCached(dir, source, ticker, interval);
  let bars = kept?.bars ?? [];
  let fetched = 0;
  const ranges: [string, string][] = [];
  if (!kept) ranges.push([from, to]);
  else {
    if (from < kept.from) ranges.push([from, kept.from]);
    if (to > kept.to) ranges.push([kept.to, to]);
  }
  for (const [a, b] of ranges) {
    const got = await fetchRange(a, b);
    fetched += got.length;
    bars = mergeBars(bars, got);
  }
  if (ranges.length > 0)
    writeFileSync(
      fileOf(dir, source, ticker, interval),
      JSON.stringify({
        source,
        from: kept && kept.from < from ? kept.from : from,
        to: kept && kept.to > to ? kept.to : to,
        bars,
      } satisfies Cached),
    );
  return { bars: bars.filter((x) => x.t >= from && x.t <= to), fetched };
}
