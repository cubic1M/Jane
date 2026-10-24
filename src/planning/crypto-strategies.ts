import {
  CRYPTO_ASSETS,
  CRYPTO_FEE,
  CRYPTO_SLIPPAGE,
  CRYPTO_STRATEGIES,
  CRYPTO_TRAIN_END,
  type CryptoAsset,
  type CryptoStrategyId,
} from "@/config/crypto-strategies";
import type { Bar } from "@/lib/market/types";
import { worstDropOf, type PathPoint } from "./backtest";

// Crypto strategies replayed (Phase AW, Stage A): a sleeve of bitcoin and ether run by a rule,
// checked each Monday from the closes before it, paying fees and slippage on what changes hands;
// cash earns nothing. Parameters are chosen on the years to CRYPTO_TRAIN_END by Sortino, then
// scored on the years after against simply holding (walk-forward). Pure. A replay of the past,
// never a forecast.

type Universe = { dates: string[]; closes: Record<CryptoAsset, number[]> };

export function alignCrypto(bars: Readonly<Record<string, readonly Bar[]>>): Universe | null {
  const maps = CRYPTO_ASSETS.map(
    (a) => new Map((bars[a] ?? []).map((b) => [b.date, b.closeCents])),
  );
  if (maps.some((m) => m.size === 0)) return null;
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => (m.get(d) ?? 0) > 0)).sort();
  return {
    dates,
    closes: Object.fromEntries(
      CRYPTO_ASSETS.map((a, i) => [a, dates.map((d) => maps[i].get(d)!)]),
    ) as Record<CryptoAsset, number[]>,
  };
}

const LOOKBACK = 200;
const isMonday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;

// The sleeve's weights on day t, from the closes before it.
export function cryptoWeights(
  id: CryptoStrategyId,
  param: number,
  u: Universe,
  t: number,
): Record<CryptoAsset, number> {
  if (id === "crypto_hold") return { BTC: 0.5, ETH: 0.5 };
  if (id === "crypto_trend") {
    const w = {} as Record<CryptoAsset, number>;
    for (const a of CRYPTO_ASSETS) {
      const c = u.closes[a];
      let sum = 0;
      for (let i = t - param; i < t; i += 1) sum += c[i];
      w[a] = c[t - 1] > sum / param ? 0.5 : 0;
    }
    return w;
  }
  const ret = (a: CryptoAsset) => u.closes[a][t - 1] / u.closes[a][t - 1 - param] - 1;
  const best = CRYPTO_ASSETS.reduce((x, y) => (ret(y) > ret(x) ? y : x));
  return { BTC: 0, ETH: 0, ...(ret(best) > 0 ? { [best]: 1 } : {}) } as Record<CryptoAsset, number>;
}

export type CryptoMetrics = {
  from: string;
  to: string;
  cagr: number;
  maxDrawdown: number;
  vol: number;
  sortino: number;
  trades: number;
};

function metrics(path: readonly PathPoint[], trades: number): CryptoMetrics {
  const r = path.slice(1).map((p, i) => p.valueCents / path[i].valueCents - 1);
  const years = Math.max(1, r.length) / 365;
  const mean = r.reduce((s, x) => s + x, 0) / Math.max(1, r.length);
  const variance = r.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, r.length - 1);
  const downside = Math.sqrt(
    r.reduce((s, x) => s + Math.min(0, x) ** 2, 0) / Math.max(1, r.length),
  );
  const cagr = (path.at(-1)!.valueCents / path[0].valueCents) ** (1 / years) - 1;
  return {
    from: path[0].date,
    to: path.at(-1)!.date,
    cagr,
    maxDrawdown: Math.max(0, -worstDropOf(path).fraction),
    vol: Math.sqrt(variance * 365),
    sortino: downside > 0 ? cagr / (downside * Math.sqrt(365)) : 0,
    trades,
  };
}

export function cryptoReplay(
  u: Universe,
  id: CryptoStrategyId,
  param: number,
  fromDate: string | null,
  toDate: string | null,
): { path: PathPoint[]; metrics: CryptoMetrics } | null {
  const from = Math.max(LOOKBACK + 1, fromDate ? u.dates.findIndex((d) => d >= fromDate) : 0);
  let to = u.dates.length - 1;
  if (toDate) while (to >= 0 && u.dates[to] > toDate) to -= 1;
  if (from < 0 || to - from < 30) return null;
  const cost = CRYPTO_FEE + CRYPTO_SLIPPAGE;
  const units = { BTC: 0, ETH: 0 } as Record<CryptoAsset, number>;
  let cash = 1_000_000;
  let trades = 0;
  const path: PathPoint[] = [];
  const valueAt = (t: number) =>
    cash + CRYPTO_ASSETS.reduce((s, a) => s + units[a] * u.closes[a][t], 0);
  for (let t = from; t <= to; t += 1) {
    const due =
      t === from ||
      (id === "crypto_hold"
        ? u.dates[t].slice(0, 7) !== u.dates[t - 1].slice(0, 7)
        : isMonday(u.dates[t]));
    if (due) {
      const value = valueAt(t);
      const w = cryptoWeights(id, param, u, t);
      for (const a of CRYPTO_ASSETS) {
        const target = w[a] * value;
        const now = units[a] * u.closes[a][t];
        const change = target - now;
        if (Math.abs(change) < value * 0.005) continue;
        const paid = Math.abs(change) * cost;
        cash -= change + paid;
        units[a] += change / u.closes[a][t];
        trades += 1;
      }
    }
    path.push({ date: u.dates[t], valueCents: valueAt(t) });
  }
  return { path, metrics: metrics(path, trades) };
}

export type CryptoResult = {
  id: CryptoStrategyId;
  param: number;
  train: CryptoMetrics;
  later: CryptoMetrics;
  holdLater: CryptoMetrics;
  // More return for its risk (Sortino) than holding, on the later years.
  beatsHolding: boolean;
  curve: number[];
};

const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// Walk-forward: the parameter with the best Sortino on the earlier years, scored on the later.
export function cryptoResult(u: Universe, id: CryptoStrategyId, points = 40): CryptoResult | null {
  const grid = CRYPTO_STRATEGIES[id].grid;
  const scored = grid
    .map((p) => ({ p, r: cryptoReplay(u, id, p, null, CRYPTO_TRAIN_END) }))
    .filter((x) => x.r !== null);
  if (scored.length === 0) return null;
  const best = scored.reduce((a, b) => (b.r!.metrics.sortino > a.r!.metrics.sortino ? b : a));
  const later = cryptoReplay(u, id, best.p, nextDay(CRYPTO_TRAIN_END), null);
  const hold = cryptoReplay(u, "crypto_hold", 0, nextDay(CRYPTO_TRAIN_END), null);
  if (!later || !hold) return null;
  const step = (later.path.length - 1) / (points - 1);
  const first = later.path[0].valueCents;
  return {
    id,
    param: best.p,
    train: best.r!.metrics,
    later: later.metrics,
    holdLater: hold.metrics,
    beatsHolding: later.metrics.sortino > hold.metrics.sortino,
    curve: Array.from(
      { length: points },
      (_, i) => Math.round((later.path[Math.round(i * step)].valueCents / first) * 1000) / 10,
    ),
  };
}
