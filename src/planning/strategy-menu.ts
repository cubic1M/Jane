import { TARGET_MIXES, type RiskLevel } from "@/config/investing";
import {
  ALL_WEATHER_FUNDS,
  ALL_WEATHER_WINDOW_DAYS,
  MENU_CURVE_POINTS,
  MENU_FIT_SLACK,
  MENU_MIX_FUNDS,
  MENU_STRATEGIES,
  SECTOR_FUNDS,
  SECTOR_LOOKBACK_DAYS,
  SECTOR_ROTATION_TOP,
  type MenuStrategyId,
} from "@/config/strategy-menu";
import { RISK_BUDGETS, STRATEGY_TRADE_COST_BPS, STRATEGY_TRAIN_END } from "@/config/strategies";
import type { Bar } from "@/lib/market/types";
import type { PathPoint } from "./backtest";
import { metricsOf, type Metrics } from "./strategies/engine";

// The strategy menu replayed (Phase AW, Stage A): each menu strategy, and the level's own mix to
// compare, rebalanced on the first trading day of each month to weights known from the closes
// before it, paying STRATEGY_TRADE_COST_BPS on what changes hands. Every one starts the same day
// (once the longest look-back has history) so they compare fairly. Pure. A replay of the past,
// never a forecast.

export type MenuId = MenuStrategyId | "mix";
type Universe = { dates: string[]; closes: Record<string, number[]> };

const BILLS = MENU_MIX_FUNDS.cash;

export function menuTickers(): string[] {
  const set = new Set<string>([
    ...Object.values(MENU_MIX_FUNDS),
    ...SECTOR_FUNDS,
    ...ALL_WEATHER_FUNDS,
  ]);
  for (const s of Object.values(MENU_STRATEGIES)) if (s.fund) set.add(s.fund);
  return [...set];
}

export function alignMenu(bars: Readonly<Record<string, readonly Bar[]>>): Universe | null {
  const tickers = menuTickers();
  const maps = tickers.map((t) => new Map((bars[t] ?? []).map((b) => [b.date, b.closeCents])));
  if (maps.some((m) => m.size === 0)) return null;
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => (m.get(d) ?? 0) > 0)).sort();
  return {
    dates,
    closes: Object.fromEntries(tickers.map((t, i) => [t, dates.map((d) => maps[i].get(d)!)])),
  };
}

// The first day every strategy can decide: after the longest look-back.
export const menuStart = () => Math.max(SECTOR_LOOKBACK_DAYS, ALL_WEATHER_WINDOW_DAYS) + 1;

function mix(level: RiskLevel): Record<string, number> {
  const m = TARGET_MIXES[level];
  return {
    [MENU_MIX_FUNDS.us_stocks]: m.us_stocks,
    [MENU_MIX_FUNDS.intl_stocks]: m.intl_stocks,
    [MENU_MIX_FUNDS.bonds]: m.bonds,
    [MENU_MIX_FUNDS.cash]: m.cash,
  };
}

const volatility = (closes: readonly number[], t: number, days: number) => {
  const r: number[] = [];
  for (let i = t - days; i < t; i += 1) r.push(closes[i] / closes[i - 1] - 1);
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  return Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, r.length - 1));
};

// The weights on day t, from the closes before it.
export function menuWeights(
  id: MenuId,
  level: RiskLevel,
  u: Universe,
  t: number,
): Record<string, number> {
  const base = mix(level);
  if (id === "mix") return base;
  const s = MENU_STRATEGIES[id];
  const us = TARGET_MIXES[level].us_stocks;
  const rest = { ...base };
  delete rest[MENU_MIX_FUNDS.us_stocks];
  if (s.rule === "tilt") return { ...rest, [s.fund!]: us };
  if (s.rule === "sector_rotation") {
    const top = [...SECTOR_FUNDS]
      .map((f) => ({ f, r: u.closes[f][t - 1] / u.closes[f][t - 1 - SECTOR_LOOKBACK_DAYS] - 1 }))
      .sort((a, b) => b.r - a.r || (a.f < b.f ? -1 : 1))
      .slice(0, SECTOR_ROTATION_TOP);
    return { ...rest, ...Object.fromEntries(top.map((x) => [x.f, us / top.length])) };
  }
  const inverse = ALL_WEATHER_FUNDS.map((f) => ({
    f,
    w: 1 / Math.max(1e-6, volatility(u.closes[f], t, ALL_WEATHER_WINDOW_DAYS)),
  }));
  const sum = inverse.reduce((a, x) => a + x.w, 0);
  return Object.fromEntries(inverse.map((x) => [x.f, x.w / sum]));
}

export type MenuReplay = { path: PathPoint[]; metrics: Metrics };

export function menuReplay(
  u: Universe,
  id: MenuId,
  level: RiskLevel,
  fromDate?: string,
): MenuReplay | null {
  let from = menuStart();
  if (fromDate)
    from = Math.max(
      from,
      u.dates.findIndex((d) => d >= fromDate),
    );
  const to = u.dates.length - 1;
  if (from < 0 || to - from < 2) return null;
  const cost = STRATEGY_TRADE_COST_BPS / 10_000;
  const tickers = Object.keys(u.closes);
  const units: Record<string, number> = Object.fromEntries(tickers.map((t) => [t, 0]));
  let value = 1_000_000;
  let traded = 0;
  let costs = 0;
  let rebalances = 0;
  const path: PathPoint[] = [];
  for (let t = from; t <= to; t += 1) {
    if (t > from) value = tickers.reduce((s, f) => s + units[f] * u.closes[f][t], 0);
    if (t === from || u.dates[t].slice(0, 7) !== u.dates[t - 1].slice(0, 7)) {
      const target = menuWeights(id, level, u, t);
      const turnover = tickers.reduce(
        (s, f) => s + Math.abs((target[f] ?? 0) * value - units[f] * u.closes[f][t]),
        0,
      );
      const paid = turnover * cost;
      traded += turnover / value;
      costs += paid / value;
      value -= paid;
      for (const f of tickers) units[f] = ((target[f] ?? 0) * value) / u.closes[f][t];
      rebalances += 1;
    }
    path.push({ date: u.dates[t], valueCents: value });
  }
  return {
    path,
    metrics: metricsOf(path, u.closes[BILLS].slice(from, to + 1), traded, costs, rebalances - 1),
  };
}

export type MenuResult = {
  id: MenuStrategyId;
  level: RiskLevel;
  whole: Metrics;
  later: Metrics;
  mix: { whole: Metrics; later: Metrics };
  // No riskier than the level's budget or its own mix, over the whole replay (fitsLevel).
  fits: boolean;
  // The whole replay, MENU_CURVE_POINTS values from 100.
  curve: number[];
};

// Fits a level: no riskier than the level's budget (RISK_BUDGETS) or the level's own mix,
// whichever allows more, in worst drop and in volatility, with MENU_FIT_SLACK of each for noise.
// The budgets are the research's targets; on these years even the mix of Very low and Low fell
// further than theirs, so the mix is the fairer bar there.
export const fitsLevel = (
  m: Pick<Metrics, "maxDrawdown" | "vol">,
  mix: Pick<Metrics, "maxDrawdown" | "vol">,
  level: RiskLevel,
) =>
  m.maxDrawdown <= Math.max(RISK_BUDGETS[level].maxDrawdown, mix.maxDrawdown) + MENU_FIT_SLACK &&
  m.vol <= Math.max(RISK_BUDGETS[level].volCap, mix.vol) + MENU_FIT_SLACK;

// The later years start the day after the research's training years end.
const LATER_FROM = (() => {
  const d = new Date(`${STRATEGY_TRAIN_END}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

export function menuResult(u: Universe, id: MenuStrategyId, level: RiskLevel): MenuResult | null {
  const whole = menuReplay(u, id, level);
  const later = menuReplay(u, id, level, LATER_FROM);
  const mixWhole = menuReplay(u, "mix", level);
  const mixLater = menuReplay(u, "mix", level, LATER_FROM);
  if (!whole || !later || !mixWhole || !mixLater) return null;
  const step = (whole.path.length - 1) / (MENU_CURVE_POINTS - 1);
  const first = whole.path[0].valueCents;
  const curve = Array.from(
    { length: MENU_CURVE_POINTS },
    (_, i) => Math.round((whole.path[Math.round(i * step)].valueCents / first) * 1000) / 10,
  );
  return {
    id,
    level,
    whole: whole.metrics,
    later: later.metrics,
    mix: { whole: mixWhole.metrics, later: mixLater.metrics },
    fits: fitsLevel(whole.metrics, mixWhole.metrics, level),
    curve,
  };
}
