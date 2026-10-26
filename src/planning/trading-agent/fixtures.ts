import type { AgentBar } from "./types";

// Made-up bars for the agent's tests: a seeded random walk per ticker, the same every run, with
// open, high, low and close. Around the clock, or New York regular hours on weekdays. Nothing here
// is a real price.

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function walkBars(
  ticker: string,
  {
    from,
    count,
    minutes,
    session = "24h",
    startCents = 10_000,
    drift = 0,
    vol = 0.01,
  }: {
    from: string;
    count: number;
    minutes: number;
    session?: "24h" | "nyse";
    startCents?: number;
    drift?: number;
    vol?: number;
  },
): AgentBar[] {
  const rand = seeded(ticker);
  const out: AgentBar[] = [];
  let price = startCents;
  let t = Date.parse(from);
  while (out.length < count) {
    const d = new Date(t);
    const day = d.getUTCDay();
    // New York hours as 14:30 to 21:00 UTC (winter time), weekdays.
    const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
    const open = session === "24h" || (day !== 0 && day !== 6 && minute >= 870 && minute < 1260);
    if (open) {
      const gap = session === "nyse" && minute === 870 ? (rand() - 0.5) * vol * 2 : 0;
      const o = price * (1 + gap);
      const c = o * (1 + drift + (rand() - 0.5) * vol * 2);
      const h = Math.max(o, c) * (1 + rand() * vol * 0.5);
      const l = Math.min(o, c) * (1 - rand() * vol * 0.5);
      out.push({
        t: d.toISOString(),
        o: Math.round(o),
        h: Math.round(h),
        l: Math.round(l),
        c: Math.round(c),
        v: 1000 + Math.round(rand() * 1000),
      });
      price = c;
    }
    t += minutes * 60_000;
  }
  return out;
}
