import { CASH_PRICE_CENTS, CASH_TICKER } from "@/config/trading-agent";
import { SESSION_CLOSE_MINUTE, SESSION_OPEN_MINUTE } from "@/config/intraday-strategies";
import { newYork } from "@/planning/intraday";
import type { AgentBar, Timeline } from "./types";

// The agent's clock (src/planning/trading-agent/). The catalog's rules count in trading days and
// check for a month's or week's end by the date; run bar by bar, each bar is one day of a made-up
// calendar of business days, so "a 200-day average" becomes a 200-bar average and "each month"
// every 21 or so bars. The made-up date is the bar's count on the agent's own axis (kept in its
// state between ticks), never anything about the bars after it, so a replay and a live catch-up
// give every bar the same date, and a market holiday is just the next bar.

const DAY_MS = 86_400_000;
// Monday, January 5, 1970, plus enough business days that history before an agent's first bar
// (a negative count) still has a date.
const MONDAY_0 = Date.UTC(1970, 0, 5);
const OFFSET = 1_000_000;

export const intervalMs = (minutes: number) => minutes * 60_000;

// Business day n of the made-up calendar, as YYYY-MM-DD.
export function madeUpDate(n: number): string {
  const k = n + OFFSET;
  const days = Math.floor(k / 5) * 7 + (k % 5);
  return new Date(MONDAY_0 + days * DAY_MS).toISOString().slice(0, 10);
}

// A New York bar inside regular hours.
export const inSession = (t: string) => {
  const { minute } = newYork(t);
  return minute >= SESSION_OPEN_MINUTE && minute < SESSION_CLOSE_MINUTE;
};

// Every ticker's bars on the master ticker's times (in session only, for New York). A ticker with
// no bar at a time carries its last close (its open, high and low too); 0 before its first.
// Plain cash is added at its fixed price.
export function timelineOf(
  bars: Readonly<Record<string, readonly AgentBar[]>>,
  master: string,
  session: "24h" | "nyse",
  // Where the count stands: the bar `at` is number `n` (the agent's last bar). Without it the
  // first bar is 0.
  anchor: { at: string; n: number } | null = null,
): Timeline {
  const own = [...(bars[master] ?? [])]
    .filter((b) => session === "24h" || inSession(b.t))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const times: string[] = [];
  for (const b of own) if (times.at(-1) !== b.t) times.push(b.t);
  // The count: the anchor's bar keeps its number; bars after it count on, bars before count back.
  let j = 0;
  let n0 = 0;
  if (anchor) {
    const at = times.findIndex((t) => t >= anchor.at);
    const exact = at >= 0 && times[at] === anchor.at;
    j = at < 0 ? times.length : at;
    n0 = exact ? anchor.n : anchor.n + 1;
  }
  const numbers = times.map((_, i) => n0 + i - j);
  const tl: Timeline = {
    times,
    numbers,
    dates: numbers.map(madeUpDate),
    nextDate: madeUpDate((numbers.at(-1) ?? 0) + 1),
    open: {},
    high: {},
    low: {},
    close: {},
  };
  for (const [ticker, list] of Object.entries(bars)) {
    const at = new Map(list.map((b) => [b.t, b]));
    const o: number[] = [];
    const h: number[] = [];
    const l: number[] = [];
    const c: number[] = [];
    let last = 0;
    for (const t of times) {
      const b = at.get(t);
      if (b && b.c > 0) {
        o.push(b.o > 0 ? b.o : b.c);
        h.push(Math.max(b.h, b.c));
        l.push(b.l > 0 ? Math.min(b.l, b.c) : b.c);
        c.push(b.c);
        last = b.c;
      } else {
        o.push(last);
        h.push(last);
        l.push(last);
        c.push(last);
      }
    }
    tl.open[ticker] = o;
    tl.high[ticker] = h;
    tl.low[ticker] = l;
    tl.close[ticker] = c;
  }
  const cash = times.map(() => CASH_PRICE_CENTS);
  tl.open[CASH_TICKER] = cash;
  tl.high[CASH_TICKER] = cash;
  tl.low[CASH_TICKER] = cash;
  tl.close[CASH_TICKER] = cash;
  return tl;
}
