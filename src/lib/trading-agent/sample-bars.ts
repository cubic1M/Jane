import { SESSION_OPEN_MINUTE } from "@/config/intraday-strategies";
import { AGENT_INTERVALS, type AgentInterval } from "@/config/trading-agent";
import { newYork } from "@/planning/intraday";
import type { AgentBar } from "@/planning/trading-agent/types";

// The 24-hour agent's sample bars (development, the tests and e2e; never presented as real): each
// bar's prices a function of the ticker and the bar's time alone, so the same bar is the same
// whenever it is asked for, and a catch-up sees what an always-on agent would have. A slow trend,
// a few overlapping waves (hours, days and weeks) and a little hashed noise. Crypto around the
// clock; funds in New York regular hours on weekdays. Nothing here is a real price.

const PROFILES: Readonly<Record<string, { base: number; drift: number; swing: number }>> = {
  "BTC/USD": { base: 6_000_000, drift: 0.3, swing: 0.04 },
  "ETH/USD": { base: 300_000, drift: 0.25, swing: 0.05 },
  SPY: { base: 60_000, drift: 0.09, swing: 0.012 },
  QQQ: { base: 50_000, drift: 0.12, swing: 0.016 },
  BIL: { base: 9_150, drift: 0.03, swing: 0.0002 },
};
const EPOCH = Date.parse("2026-01-01T00:00:00Z");
const YEAR = 365.25 * 86_400_000;

function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const profileOf = (ticker: string) => {
  const p = PROFILES[ticker];
  if (p) return p;
  // Any other fund: a price and swing from its name.
  return { base: 2_000 + Math.round(hash(`${ticker}:base`) * 20_000), drift: 0.05, swing: 0.01 };
};

// The price at a moment, in cents.
function priceAt(ticker: string, ms: number): number {
  const p = profileOf(ticker);
  const years = (ms - EPOCH) / YEAR;
  const phase = (k: number) => hash(`${ticker}:phase:${k}`) * 2 * Math.PI;
  const wave = (hours: number, k: number) =>
    Math.sin((2 * Math.PI * ms) / (hours * 3_600_000) + phase(k));
  const log =
    p.drift * years +
    p.swing * (1.5 * wave(24 * 21, 0) + wave(24 * 5, 1) + 0.6 * wave(24, 2) + 0.4 * wave(6, 3)) +
    p.swing * 0.3 * (hash(`${ticker}:${Math.floor(ms / 900_000)}`) - 0.5);
  return p.base * Math.exp(log);
}

function barAt(ticker: string, start: number, minutes: number): AgentBar {
  const end = start + minutes * 60_000;
  const o = priceAt(ticker, start);
  const c = priceAt(ticker, end - 1);
  const mid = priceAt(ticker, (start + end) / 2);
  const wick = profileOf(ticker).swing * 0.1;
  return {
    t: new Date(start).toISOString(),
    o: Math.round(o),
    h: Math.round(Math.max(o, c, mid) * (1 + wick * hash(`${ticker}:${start}:h`))),
    l: Math.round(Math.min(o, c, mid) * (1 - wick * hash(`${ticker}:${start}:l`))),
    c: Math.round(c),
    v: 1_000 + Math.round(hash(`${ticker}:${start}:v`) * 1_000),
  };
}

// New York's 9:30 open on a day, in UTC (13:30 in summer time, 14:30 in winter).
function openOn(day: string): number {
  for (const h of ["13", "14"]) {
    const t = `${day}T${h}:30:00.000Z`;
    if (newYork(t).minute === SESSION_OPEN_MINUTE) return Date.parse(t);
  }
  return Date.parse(`${day}T14:30:00.000Z`);
}

// The bars that start from..to (ISO), oldest first.
export function sampleAgentBars(
  ticker: string,
  from: string,
  to: string,
  interval: AgentInterval,
): AgentBar[] {
  const minutes = AGENT_INTERVALS[interval].minutes;
  const step = minutes * 60_000;
  const a = Date.parse(from);
  const b = Date.parse(to);
  const out: AgentBar[] = [];
  if (ticker.includes("/")) {
    for (let t = Math.ceil(a / step) * step; t <= b; t += step) out.push(barAt(ticker, t, minutes));
    return out;
  }
  for (let d = Math.floor(a / 86_400_000) * 86_400_000; d <= b; d += 86_400_000) {
    const weekday = new Date(d).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const open = openOn(new Date(d).toISOString().slice(0, 10));
    for (let k = 0; k * minutes < 390; k += 1) {
      const t = open + k * step;
      if (t >= a && t <= b) out.push(barAt(ticker, t, Math.min(minutes, 390 - k * minutes)));
    }
  }
  return out;
}
