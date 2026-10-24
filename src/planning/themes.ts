import {
  THEME_BENCHMARK,
  THEME_COST_BPS,
  THEME_HOLD_DAYS,
  THEME_MIN_HIT_RATE,
  THEME_STOP_LOSS,
  type Theme,
} from "@/config/themes";
import { THEME_FUNDS } from "@/config/portfolios";
import type { Bar } from "@/lib/market/types";
import { positionValue, type PlannedTrade, type Prices } from "./practice-autopilot";
import type { LedgerState } from "./practice-ledger";
import type { PastTrade } from "./practice-scan";

// A news theme on its past events (Phase AW, Stage A): bought at the close of the day the news
// broke, sold THEME_HOLD_DAYS trading days later or at the close it first falls THEME_STOP_LOSS
// below the buy, after costs, against the whole US market over the same days. The same exit the
// practice idea states. Pure. A replay of the past, not a forecast.

export type ThemeTrade = {
  event: string;
  bought: string;
  sold: string;
  stopped: boolean;
  // The theme fund's return and the market's over the same days, as fractions.
  returnShare: number;
  marketShare: number;
};

export type ThemeEvidence = {
  events: number;
  // Beat the market over the same days.
  hits: number;
  hitRate: number;
  averageReturn: number;
  averageExcess: number;
  worst: number;
  best: number;
  // Held up: beat the market on average and in at least THEME_MIN_HIT_RATE of the events.
  heldUp: boolean;
};

const at = (bars: readonly Bar[], date: string) => bars.findIndex((b) => b.date >= date);

export function themeTrades(
  bars: Readonly<Record<string, readonly Bar[]>>,
  theme: Pick<Theme, "ticker" | "events">,
): ThemeTrade[] {
  const fund = bars[theme.ticker] ?? [];
  const market = bars[THEME_BENCHMARK] ?? [];
  const cost = (2 * THEME_COST_BPS) / 10_000;
  const out: ThemeTrade[] = [];
  for (const event of theme.events) {
    const i = at(fund, event);
    if (i < 0 || i + THEME_HOLD_DAYS >= fund.length) continue;
    const buy = fund[i].closeCents;
    let j = i + THEME_HOLD_DAYS;
    let stopped = false;
    for (let k = i + 1; k <= i + THEME_HOLD_DAYS; k += 1) {
      if (fund[k].closeCents <= buy * (1 - THEME_STOP_LOSS)) {
        j = k;
        stopped = true;
        break;
      }
    }
    const m0 = at(market, fund[i].date);
    const m1 = at(market, fund[j].date);
    if (m0 < 0 || m1 < 0) continue;
    out.push({
      event,
      bought: fund[i].date,
      sold: fund[j].date,
      stopped,
      returnShare: fund[j].closeCents / buy - 1 - cost,
      marketShare: market[m1].closeCents / market[m0].closeCents - 1,
    });
  }
  return out;
}

export function themeEvidence(trades: readonly ThemeTrade[]): ThemeEvidence {
  const n = trades.length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const hits = trades.filter((t) => t.returnShare > t.marketShare).length;
  const averageExcess = avg(trades.map((t) => t.returnShare - t.marketShare));
  const hitRate = n ? hits / n : 0;
  return {
    events: n,
    hits,
    hitRate,
    averageReturn: avg(trades.map((t) => t.returnShare)),
    averageExcess,
    worst: n ? Math.min(...trades.map((t) => t.returnShare)) : 0,
    best: n ? Math.max(...trades.map((t) => t.returnShare)) : 0,
    heldUp: n > 0 && averageExcess > 0 && hitRate >= THEME_MIN_HIT_RATE,
  };
}

// When to get out of a theme slice the person said yes to (Phase AW): the whole position, after
// THEME_HOLD_DAYS trading days from the buy, or as soon as it closes THEME_STOP_LOSS below what it
// was bought at, as the idea said. The live autopilot sells with this, by itself; in suggest-only
// mode it is shown, as every plan is.
export function themeExits(
  state: LedgerState,
  prices: Prices,
  trades: readonly Pick<
    PastTrade,
    "placedAt" | "side" | "ticker" | "quantity" | "amountCents" | "rule"
  >[],
  today: string,
): PlannedTrade[] {
  const out: PlannedTrade[] = [];
  for (const ticker of THEME_FUNDS) {
    const p = state.positions[ticker];
    const price = prices[ticker];
    if (!p || p.quantity <= 0 || !price) continue;
    const buy = trades
      .filter((t) => t.ticker === ticker && t.side === "buy" && (t.quantity ?? 0) > 0)
      .sort((a, b) => (a.placedAt < b.placedAt ? 1 : -1))[0];
    if (!buy) continue;
    const bought = buy.placedAt.slice(0, 10);
    const boughtAt = buy.amountCents / buy.quantity!;
    const days = tradingDaysBetween(bought, today);
    const stopped = price <= boughtAt * (1 - THEME_STOP_LOSS);
    if (days < THEME_HOLD_DAYS && !stopped) continue;
    const amountCents = positionValue(state, prices, ticker);
    const change = price / boughtAt - 1;
    const moved = `${change >= 0 ? "up" : "down"} ${(Math.abs(change) * 100).toFixed(1)}%`;
    out.push({
      ticker,
      side: "sell",
      amountCents,
      rule: "theme_exit",
      reason: stopped
        ? `Out of ${ticker} at the stop: ${moved} since the news theme's buy on ${bought}, past the ${Math.round(THEME_STOP_LOSS * 100)}% it was allowed to fall.`
        : `Out of ${ticker} after ${days} trading days, as the news theme said: ${moved} since the buy on ${bought}.`,
    });
  }
  return out;
}

// Weekdays after `from`, up to and including `to`.
export function tradingDaysBetween(from: string, to: string): number {
  let n = 0;
  for (
    let t = Date.parse(`${from}T00:00:00Z`) + 86_400_000;
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n += 1;
  }
  return n;
}
