import { addDays } from "./demo-bank";

// The stand-in daily price feed (spec step 156) for the demo bank's funds: made-up prices
// that move a little every day, together like a real market, so returns, drift and drops
// have something to show. Deterministic: the same ticker and day always give the same
// price. Anchored on the day the demo bank was linked: the day before it, every price is
// the demo bank's own (src/data-sources/demo/demo-holdings.ts), so the first sync shows
// the familiar numbers and prices move from there, forwards and back. Pure.

// The feed starts here; earlier days use the first price.
export const PRICE_HISTORY_START = "2024-01-01";

type Profile = {
  // Price on the anchor's eve, in dollars.
  base: number;
  // Drift a year, and how much it moves a day.
  drift: number;
  vol: number;
  // How much of its move is the whole market's.
  beta: number;
};

export const DEMO_PRICE_PROFILES: Readonly<Record<string, Profile>> = {
  NSTDX: { base: 25.17, drift: 0.06, vol: 0.009, beta: 0.85 },
  SLGFX: { base: 51.36, drift: 0.07, vol: 0.013, beta: 0.95 },
  KTSIX: { base: 142.18, drift: 0.07, vol: 0.011, beta: 1 },
  KTBIX: { base: 9.84, drift: 0.02, vol: 0.003, beta: 0.1 },
  KTIIX: { base: 34.12, drift: 0.05, vol: 0.011, beta: 0.8 },
  KTRGX: { base: 18.4, drift: 0.06, vol: 0.009, beta: 0.85 },
  ACME: { base: 136.4, drift: 0.08, vol: 0.02, beta: 0.7 },
  PDIFX: { base: 21.72, drift: 0.04, vol: 0.009, beta: 0.8 },
  KLCX: { base: 452.3, drift: 0.07, vol: 0.011, beta: 1 },
  KDVX: { base: 41.25, drift: 0.05, vol: 0.009, beta: 0.85 },
};

// Cash-like holdings always cost a dollar.
export const CASH_TICKERS: readonly string[] = ["DSVXX", "CASH"];

// A seeded number in [0, 1).
function unit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += 0x6d2b79f5;
  let t = h;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Roughly normal, mean 0 and spread 1 (the sum of four uniforms).
const normal = (key: string) =>
  (unit(`${key}:a`) + unit(`${key}:b`) + unit(`${key}:c`) + unit(`${key}:d`) - 2) * Math.sqrt(3);

const DAY_MS = 86_400_000;
const dayIndex = (day: string) =>
  Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${PRICE_HISTORY_START}T00:00:00Z`)) / DAY_MS,
  );

// Cumulative log moves from the start, per ticker, filled as far as asked.
const cumulative = new Map<string, number[]>();

function walk(ticker: string, index: number): number {
  if (index <= 0) return 0;
  const p = DEMO_PRICE_PROFILES[ticker];
  let sums = cumulative.get(ticker);
  if (!sums) {
    sums = [0];
    cumulative.set(ticker, sums);
  }
  while (sums.length <= index) {
    const i = sums.length;
    const day = addDays(PRICE_HISTORY_START, i);
    const market = normal(`market:${day}`);
    const own = normal(`${ticker}:${day}`);
    const shock = p.beta * market + Math.sqrt(Math.max(0, 1 - p.beta * p.beta)) * own;
    sums.push(sums[i - 1] + p.drift / 365 + p.vol * shock);
  }
  return sums[index];
}

// The price on `day`, in dollars (to 4 places), or null for a ticker the feed doesn't carry.
export function demoPrice(ticker: string, day: string, anchor: string): number | null {
  const t = ticker.toUpperCase();
  if (CASH_TICKERS.includes(t)) return 1;
  const p = DEMO_PRICE_PROFILES[t];
  if (!p) return null;
  const ref = dayIndex(addDays(anchor, -1));
  const price = p.base * Math.exp(walk(t, dayIndex(day)) - walk(t, ref));
  return Math.round(price * 10_000) / 10_000;
}
