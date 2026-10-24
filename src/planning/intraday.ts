import {
  INTRADAY_RULES,
  INTRADAY_SLIPPAGE,
  INTRADAY_TRAIN_END,
  KILLZONE_END_MINUTE,
  SESSION_CLOSE_MINUTE,
  SESSION_OPEN_MINUTE,
  VWAP_LAST_ENTRY_MINUTE,
  type IntradayRuleId,
} from "@/config/intraday-strategies";
import type { IntradayBar } from "@/lib/market/types";
import { worstDropOf, type PathPoint } from "./backtest";

// The day-trading rules replayed (Phase AW, Stage A, Very high only): each New York session of
// 5-minute bars, at most one trade a day per rule, long only, the whole sleeve in the trade,
// out at its stop, its target or the last bar's close (never held overnight). When one bar
// touches both the stop and the target, the stop is counted (the worse of the two). Every trade
// pays INTRADAY_SLIPPAGE each way. The rules' one setting is chosen on the sessions to
// INTRADAY_TRAIN_END by Sortino and scored on the later ones against holding the fund over the
// same sessions (walk-forward). Pure. A replay of the past, never a forecast.

export type SessionBar = IntradayBar & { minute: number };
export type Session = { date: string; bars: SessionBar[] };

const NY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// A bar's New York date and minute of the day.
export function newYork(t: string): { date: string; minute: number } {
  const parts = Object.fromEntries(NY.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// Regular-hours bars grouped into sessions, oldest first.
export function sessionsOf(bars: readonly IntradayBar[]): Session[] {
  const by = new Map<string, SessionBar[]>();
  for (const b of bars) {
    const { date, minute } = newYork(b.t);
    if (minute < SESSION_OPEN_MINUTE || minute >= SESSION_CLOSE_MINUTE) continue;
    const list = by.get(date) ?? [];
    list.push({ ...b, minute });
    by.set(date, list);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => ({ date, bars: list.sort((a, b) => a.minute - b.minute) }))
    .filter((s) => s.bars.length >= 30);
}

export type Trade = {
  date: string;
  entry: number;
  exit: number;
  reason: "stop" | "target" | "close" | "vwap";
};

// Out of a trade entered on bar `from` (after its close): the first later bar that reaches the
// stop (at the stop) or the target (at the target), else the last bar's close.
function exitFrom(
  bars: readonly SessionBar[],
  from: number,
  stop: number,
  target: number | null,
): { exit: number; reason: Trade["reason"] } {
  for (let i = from + 1; i < bars.length; i += 1) {
    if (bars[i].l <= stop) return { exit: Math.min(stop, bars[i].o), reason: "stop" };
    if (target !== null && bars[i].h >= target)
      return { exit: Math.max(target, bars[i].o), reason: "target" };
  }
  return { exit: bars[bars.length - 1].c, reason: "close" };
}

// One session's trade for a rule, or null. `prior` is the session before (the prior day's low).
export function tradeOf(
  id: IntradayRuleId,
  param: number,
  s: Session,
  prior: Session | null,
): Trade | null {
  const b = s.bars;
  const inKillzone = (i: number) => b[i].minute < KILLZONE_END_MINUTE;
  if (id === "opening_range") {
    const n = Math.round(param / 5);
    if (b.length <= n) return null;
    const hi = Math.max(...b.slice(0, n).map((x) => x.h));
    const lo = Math.min(...b.slice(0, n).map((x) => x.l));
    for (let i = n; i < b.length - 1; i += 1) {
      if (b[i].c > hi) {
        const entry = b[i].c;
        const out = exitFrom(b, i, lo, entry + 2 * (entry - lo));
        return { date: s.date, entry, ...out };
      }
    }
    return null;
  }
  if (id === "liquidity_sweep") {
    if (!prior) return null;
    const pdl = Math.min(...prior.bars.map((x) => x.l));
    for (let i = 0; i < b.length - 1 && inKillzone(i); i += 1) {
      if (b[i].l < pdl && b[i].c > pdl) {
        const entry = b[i].c;
        const stop = b[i].l;
        const out = exitFrom(b, i, stop, entry + param * (entry - stop));
        return { date: s.date, entry, ...out };
      }
    }
    return null;
  }
  if (id === "fair_value_gap") {
    for (let i = 2; i < b.length - 1 && inKillzone(i); i += 1) {
      const gapBottom = b[i - 2].h;
      const gapTop = b[i].l;
      if (gapTop - gapBottom < param * b[i].c) continue;
      for (let j = i + 1; j < b.length - 1 && inKillzone(j); j += 1) {
        if (b[j].l <= gapTop && b[j].c >= gapBottom) {
          const entry = b[j].c;
          const stop = b[i - 2].l;
          if (stop >= entry) return null;
          const out = exitFrom(b, j, stop, entry + 2 * (entry - stop));
          return { date: s.date, entry, ...out };
        }
        if (b[j].c < gapBottom) break;
      }
    }
    return null;
  }
  if (id === "vwap_reversion") {
    let pv = 0;
    let vol = 0;
    for (let i = 0; i < b.length - 1; i += 1) {
      pv += ((b[i].h + b[i].l + b[i].c) / 3) * b[i].v;
      vol += b[i].v;
      if (vol <= 0 || b[i].minute >= VWAP_LAST_ENTRY_MINUTE) continue;
      const vwap = pv / vol;
      if (b[i].c <= vwap * (1 - param)) {
        const entry = b[i].c;
        const stop = entry * (1 - 2 * param);
        // Out at the session's VWAP as it stands: track it on.
        let pv2 = pv;
        let v2 = vol;
        for (let k = i + 1; k < b.length; k += 1) {
          pv2 += ((b[k].h + b[k].l + b[k].c) / 3) * b[k].v;
          v2 += b[k].v;
          const now = pv2 / Math.max(1, v2);
          if (b[k].l <= stop)
            return { date: s.date, entry, exit: Math.min(stop, b[k].o), reason: "stop" };
          if (b[k].h >= now)
            return { date: s.date, entry, exit: Math.max(now, b[k].o), reason: "vwap" };
        }
        return { date: s.date, entry, exit: b[b.length - 1].c, reason: "close" };
      }
    }
    return null;
  }
  // volume_imbalance
  for (let i = 12; i < b.length - 2 && inKillzone(i); i += 1) {
    const avg = b.slice(i - 12, i).reduce((x, y) => x + y.v, 0) / 12;
    const range = b[i].h - b[i].l;
    if (range <= 0 || b[i].c <= b[i].o) continue;
    if ((b[i].c - b[i].l) / range < 0.8 || b[i].v < param * avg) continue;
    const entry = b[i + 1].o;
    const stop = b[i].l;
    if (stop >= entry) continue;
    const out = exitFrom(b, i, stop, entry + 2 * (entry - stop));
    return { date: s.date, entry, ...out };
  }
  return null;
}

export type IntradayMetrics = {
  from: string;
  to: string;
  sessions: number;
  trades: number;
  winRate: number;
  averageTrade: number;
  cagr: number;
  maxDrawdown: number;
  vol: number;
  sortino: number;
};

function metricsOf(path: readonly PathPoint[], trades: readonly number[]): IntradayMetrics {
  const r = path.slice(1).map((p, i) => p.valueCents / path[i].valueCents - 1);
  const years = Math.max(1, r.length) / 252;
  const mean = r.reduce((s, x) => s + x, 0) / Math.max(1, r.length);
  const variance = r.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, r.length - 1);
  const downside = Math.sqrt(
    r.reduce((s, x) => s + Math.min(0, x) ** 2, 0) / Math.max(1, r.length),
  );
  const cagr = (path.at(-1)!.valueCents / path[0].valueCents) ** (1 / years) - 1;
  return {
    from: path[0].date,
    to: path.at(-1)!.date,
    sessions: path.length - 1,
    trades: trades.length,
    winRate: trades.length ? trades.filter((t) => t > 0).length / trades.length : 0,
    averageTrade: trades.length ? trades.reduce((s, x) => s + x, 0) / trades.length : 0,
    cagr,
    maxDrawdown: Math.max(0, -worstDropOf(path).fraction),
    vol: Math.sqrt(variance * 252),
    sortino: downside > 0 ? cagr / (downside * Math.sqrt(252)) : 0,
  };
}

// A rule over a run of sessions: the sleeve's value each session's end, from 100.
export function intradayReplay(
  sessions: readonly Session[],
  id: IntradayRuleId,
  param: number,
): { path: PathPoint[]; metrics: IntradayMetrics } | null {
  if (sessions.length < 3) return null;
  let value = 1_000_000;
  const path: PathPoint[] = [{ date: sessions[0].date, valueCents: value }];
  const trades: number[] = [];
  for (let k = 1; k < sessions.length; k += 1) {
    const t = tradeOf(id, param, sessions[k], sessions[k - 1]);
    if (t) {
      const r = (t.exit * (1 - INTRADAY_SLIPPAGE)) / (t.entry * (1 + INTRADAY_SLIPPAGE)) - 1;
      trades.push(r);
      value *= 1 + r;
    }
    path.push({ date: sessions[k].date, valueCents: value });
  }
  return { path, metrics: metricsOf(path, trades) };
}

// Holding the fund over the same sessions, close to close.
export function holdReplay(
  sessions: readonly Session[],
): { path: PathPoint[]; metrics: IntradayMetrics } | null {
  if (sessions.length < 3) return null;
  const first = sessions[0].bars.at(-1)!.c;
  const path = sessions.map((s) => ({
    date: s.date,
    valueCents: (1_000_000 * s.bars.at(-1)!.c) / first,
  }));
  return { path, metrics: metricsOf(path, []) };
}

export type IntradayResult = {
  id: IntradayRuleId;
  param: number;
  train: IntradayMetrics;
  later: IntradayMetrics;
  holdLater: IntradayMetrics;
  // More return for its risk (Sortino) than holding the fund, on the later sessions.
  beatsHolding: boolean;
  curve: number[];
};

export function intradayResult(
  sessions: readonly Session[],
  id: IntradayRuleId,
  points = 40,
): IntradayResult | null {
  const train = sessions.filter((s) => s.date <= INTRADAY_TRAIN_END);
  const later = sessions.filter((s) => s.date > INTRADAY_TRAIN_END);
  const scored = INTRADAY_RULES[id].grid
    .map((p) => ({ p, r: intradayReplay(train, id, p) }))
    .filter((x) => x.r !== null);
  if (scored.length === 0) return null;
  const best = scored.reduce((a, b) => (b.r!.metrics.sortino > a.r!.metrics.sortino ? b : a));
  const run = intradayReplay(later, id, best.p);
  const hold = holdReplay(later);
  if (!run || !hold) return null;
  const step = (run.path.length - 1) / (points - 1);
  return {
    id,
    param: best.p,
    train: best.r!.metrics,
    later: run.metrics,
    holdLater: hold.metrics,
    beatsHolding: run.metrics.sortino > hold.metrics.sortino,
    curve: Array.from(
      { length: points },
      (_, i) => Math.round((run.path[Math.round(i * step)].valueCents / 1_000_000) * 1000) / 10,
    ),
  };
}
