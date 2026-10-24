import {
  CATALOG,
  CATALOG_MAX_WEIGHT,
  OVERLAY_FUNDS,
  SECTORS,
  TEN,
  type CatalogId,
} from "@/config/strategy-catalog";
import {
  covariance,
  hrp,
  m13612u,
  m13612w,
  maxDiversification,
  minVariance,
  MONTH,
  ret,
  returnsBefore,
  rsi,
  sd,
  sma,
} from "./math";

// Each catalog strategy's rule (src/config/strategy-catalog.ts) as the weights it holds after
// day t's close, from the closes up to and including t, over its own funds. Null holds what it
// has. The engine (./engine.ts) trades at that close and earns from the next day. Pure.

export type Bars = { o: number; h: number; l: number; c: number };
export type Universe = {
  dates: string[];
  // Closes by ticker on `dates`; 0 where the fund had no close yet.
  closes: Record<string, number[]>;
  // SPY's daily bars, for the internal bar strength.
  spy?: (Bars | null)[];
};
export type Weights = Record<string, number>;
export type Context = {
  // The strategy's own value (its index), after day t, and what it holds now.
  value: number;
  held: Weights;
  // Its own memory between days (a floor, a peak).
  memo: Record<string, number>;
};

const isMonthEnd = (u: Universe, t: number) =>
  t + 1 >= u.dates.length || u.dates[t + 1].slice(0, 7) !== u.dates[t].slice(0, 7);
const isWeekEnd = (u: Universe, t: number) => {
  if (t + 1 >= u.dates.length) return true;
  const day = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
  return day(u.dates[t + 1]) < day(u.dates[t]);
};
const has = (u: Universe, tickers: readonly string[], t: number, back: number) =>
  t - back >= 0 && tickers.every((x) => (u.closes[x]?.[t - back] ?? 0) > 0);
const c = (u: Universe, x: string) => u.closes[x];
const equal = (tickers: readonly string[]): Weights =>
  Object.fromEntries(tickers.map((x) => [x, 1 / tickers.length]));
const top = <T>(xs: T[], k: number, by: (x: T) => number) =>
  [...xs].sort((a, b) => by(b) - by(a)).slice(0, k);
const add = (w: Weights, x: string, v: number) => {
  w[x] = (w[x] ?? 0) + v;
};
const YEAR = 12 * MONTH;

function fixed(u: Universe, t: number, w: Weights): Weights | null {
  if (!has(u, Object.keys(w), t, 0)) return null;
  return isMonthEnd(u, t) ? w : null;
}

// The volatility-scaled, optimizer and clustering rules over a set of funds.
function optimized(
  u: Universe,
  t: number,
  tickers: readonly string[],
  days: number,
  how: "min" | "maxdiv" | "hrp",
) {
  if (!isMonthEnd(u, t) || !has(u, tickers, t, days + 1)) return null;
  const r = returnsBefore(
    tickers.map((x) => c(u, x)),
    t + 1,
    days,
  );
  const cov = covariance(r);
  const w =
    how === "min"
      ? minVariance(cov, CATALOG_MAX_WEIGHT)
      : how === "maxdiv"
        ? maxDiversification(cov, CATALOG_MAX_WEIGHT)
        : hrp(cov);
  return Object.fromEntries(tickers.map((x, i) => [x, w[i]]));
}

// Keller's canary rules share this: the best `k` of `pool` by `score`, equal weight.
function bestOf(
  u: Universe,
  t: number,
  pool: readonly string[],
  k: number,
  score: (x: string) => number | null,
) {
  const s = pool
    .map((x) => ({ x, v: score(x) }))
    .filter((p): p is { x: string; v: number } => p.v !== null);
  if (s.length < pool.length) return null;
  return top(s, k, (p) => p.v).map((p) => p.x);
}

export function decide(
  id: CatalogId,
  p: number,
  u: Universe,
  t: number,
  ctx: Context,
): Weights | null {
  const e = CATALOG[id];
  switch (id) {
    case "sixty_forty":
      return fixed(u, t, { VTI: 0.6, BND: 0.4 });
    case "permanent_portfolio":
      return fixed(u, t, { SPY: 0.25, TLT: 0.25, GLD: 0.25, BIL: 0.25 });
    case "golden_butterfly":
      return fixed(u, t, { VTI: 0.2, IJS: 0.2, TLT: 0.2, SHY: 0.2, GLD: 0.2 });
    case "no_brainer":
      return fixed(u, t, { SPY: 0.25, IJR: 0.25, EFA: 0.25, SHY: 0.25 });
    case "coffeehouse":
      return fixed(u, t, { SPY: 0.1, IVE: 0.1, IJR: 0.1, IJS: 0.1, EFA: 0.1, VNQ: 0.1, BND: 0.4 });
    case "larry":
      return fixed(u, t, { IJS: 0.15, DLS: 0.075, DGS: 0.075, IEF: 0.7 });
    case "all_weather_fixed":
      return fixed(u, t, { VTI: 0.3, TLT: 0.4, IEF: 0.15, GLD: 0.075, DBC: 0.075 });
    case "faber_gtaa5": {
      const funds = ["VTI", "VEU", "VNQ", "IEF", "DBC"];
      if (!isMonthEnd(u, t) || !has(u, [...funds, "BIL"], t, p * MONTH)) return null;
      const w: Weights = {};
      for (const f of funds) add(w, c(u, f)[t] > sma(c(u, f), t, p * MONTH)! ? f : "BIL", 0.2);
      return w;
    }
    case "faber_gtaa_top": {
      if (!isMonthEnd(u, t) || !has(u, [...TEN, "BIL"], t, YEAR)) return null;
      const picks = bestOf(u, t, TEN, p, (x) => m13612u(c(u, x), t))!;
      const w: Weights = {};
      for (const f of picks)
        add(
          w,
          c(u, f)[t] > sma(c(u, f), t, 10 * MONTH)! && m13612u(c(u, f), t)! > 0 ? f : "BIL",
          1 / p,
        );
      return w;
    }
    case "dual_momentum": {
      if (!isMonthEnd(u, t) || !has(u, e.tickers, t, p * MONTH)) return null;
      const r = (x: string) => ret(c(u, x), t, p * MONTH)!;
      if (r("SPY") <= r("BIL")) return { AGG: 1 };
      return { [r("SPY") >= r("VEU") ? "SPY" : "VEU"]: 1 };
    }
    case "vaa_g4": {
      if (!isMonthEnd(u, t) || !has(u, e.tickers, t, YEAR)) return null;
      const off = ["SPY", "EFA", "EEM", "AGG"];
      const m = (x: string) => m13612w(c(u, x), t)!;
      const pool = off.every((x) => m(x) > 0) ? off : ["SHY", "IEF", "LQD"];
      return equal(top(pool, 1, m));
    }
    case "daa": {
      if (!isMonthEnd(u, t) || !has(u, e.tickers, t, YEAR)) return null;
      const off = [
        "SPY",
        "IWM",
        "QQQ",
        "EFA",
        "EEM",
        "VNQ",
        "DBC",
        "GLD",
        "TLT",
        "HYG",
        "LQD",
        "IEF",
      ];
      const m = (x: string) => m13612w(c(u, x), t)!;
      const bad = ["EEM", "BND"].filter((x) => m(x) <= 0).length;
      const cash = top(["SHY", "IEF", "LQD"], 1, m)[0];
      const share = bad === 0 ? 1 : bad === 1 ? 0.5 : 0;
      const w: Weights = {};
      for (const f of top(off, p, m)) add(w, f, share / p);
      if (share < 1) add(w, cash, 1 - share);
      return w;
    }
    case "baa": {
      if (!isMonthEnd(u, t) || !has(u, e.tickers, t, YEAR)) return null;
      const canary = ["SPY", "EEM", "EFA", "BND"];
      const off = [
        "SPY",
        "IWM",
        "QQQ",
        "EFA",
        "EEM",
        "VNQ",
        "DBC",
        "GLD",
        "TLT",
        "HYG",
        "LQD",
        "IEF",
      ];
      const def = ["TIP", "DBC", "BIL", "IEF", "TLT", "LQD", "BND"];
      const sma12 = (x: string) => c(u, x)[t] / sma(c(u, x), t, YEAR)! - 1;
      if (canary.every((x) => m13612w(c(u, x), t)! > 0)) return equal(top(off, p, sma12));
      const w: Weights = {};
      for (const f of top(def, 3, sma12)) add(w, sma12(f) < sma12("BIL") ? "BIL" : f, 1 / 3);
      return w;
    }
    case "haa": {
      if (!isMonthEnd(u, t) || !has(u, e.tickers, t, YEAR)) return null;
      const off = ["SPY", "IWM", "EFA", "EEM", "VNQ", "DBC", "IEF", "TLT"];
      const m = (x: string) => m13612u(c(u, x), t)!;
      const cash = m("IEF") > m("BIL") ? "IEF" : "BIL";
      if (m("TIP") <= 0) return { [cash]: 1 };
      const w: Weights = {};
      for (const f of top(off, p, m)) add(w, m(f) > 0 ? f : cash, 1 / p);
      return w;
    }
    case "paa": {
      if (!isMonthEnd(u, t) || !has(u, e.tickers, t, YEAR)) return null;
      const risky = e.tickers.filter((x) => x !== "IEF");
      const m = (x: string) => c(u, x)[t] / sma(c(u, x), t, YEAR)! - 1;
      const n = risky.filter((x) => m(x) > 0).length;
      const n1 = (p * risky.length) / 4;
      const bf = Math.min(1, Math.max(0, (risky.length - n) / (risky.length - n1)));
      const picks = top(
        risky.filter((x) => m(x) > 0),
        6,
        m,
      );
      const w: Weights = {};
      if (picks.length === 0 || bf >= 1) return { IEF: 1 };
      for (const f of picks) add(w, f, (1 - bf) / picks.length);
      if (bf > 0) add(w, "IEF", bf);
      return w;
    }
    case "accelerating_dual_momentum": {
      if (!isMonthEnd(u, t) || !has(u, e.tickers, t, 6 * MONTH)) return null;
      const score = (x: string) =>
        ([1, 3, 6].map((k) => ret(c(u, x), t, k * MONTH)!) as number[]).reduce((a, v) => a + v, 0) /
        3;
      const best = score("SPY") >= score("SCZ") ? "SPY" : "SCZ";
      if (score(best) > 0) return { [best]: 1 };
      return { [ret(c(u, "TLT"), t, MONTH)! >= ret(c(u, "TIP"), t, MONTH)! ? "TLT" : "TIP"]: 1 };
    }
    case "composite_dual_momentum": {
      if (!isMonthEnd(u, t) || !has(u, e.tickers, t, p * MONTH)) return null;
      const r = (x: string) => ret(c(u, x), t, p * MONTH)!;
      const w: Weights = {};
      for (const [a, b] of [
        ["SPY", "EFA"],
        ["HYG", "LQD"],
        ["VNQ", "REM"],
        ["GLD", "TLT"],
      ]) {
        const pick = r(a) >= r(b) ? a : b;
        add(w, r(pick) > r("BIL") ? pick : "BIL", 0.25);
      }
      return w;
    }
    case "eaa": {
      const pool = ["SPY", "QQQ", "IWM", "VGK", "EWJ", "EEM", "VNQ", "DBC", "GLD", "TLT", "IEF"];
      if (!isMonthEnd(u, t) || !has(u, e.tickers, t, YEAR + 1)) return null;
      const r = (x: string) => {
        const b = m13612u(c(u, "BIL"), t)!;
        return m13612u(c(u, x), t)! - b;
      };
      // Monthly returns over the last 12 months, and their equal-weight average's.
      const monthly = (x: string) =>
        Array.from(
          { length: 12 },
          (_, k) => c(u, x)[t - k * MONTH] / c(u, x)[t - (k + 1) * MONTH] - 1,
        );
      const series = Object.fromEntries(pool.map((x) => [x, monthly(x)]));
      const index = Array.from(
        { length: 12 },
        (_, k) => pool.reduce((a, x) => a + series[x][k], 0) / pool.length,
      );
      const corr = (a: number[], b: number[]) => {
        const ma = a.reduce((s, x) => s + x, 0) / a.length;
        const mb = b.reduce((s, x) => s + x, 0) / b.length;
        const cov = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0);
        const va = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0));
        const vb = Math.sqrt(b.reduce((s, x) => s + (x - mb) ** 2, 0));
        return va > 0 && vb > 0 ? cov / (va * vb) : 0;
      };
      const positive = pool.filter((x) => r(x) > 0);
      const cashShare = (pool.length - positive.length) / pool.length;
      const z = (x: string) => (r(x) * Math.sqrt(Math.max(0, 1 - corr(series[x], index)))) ** p;
      const picks = top(positive, Math.ceil(1 + Math.sqrt(pool.length)), z).filter((x) => z(x) > 0);
      const sum = picks.reduce((a, x) => a + z(x), 0);
      if (picks.length === 0 || sum <= 0) return { SHY: 1 };
      const w: Weights = {};
      for (const f of picks) add(w, f, ((1 - cashShare) * z(f)) / sum);
      if (cashShare > 0) add(w, "SHY", cashShare);
      return w;
    }
    case "kda": {
      const pool = ["SPY", "VGK", "EWJ", "EEM", "VNQ", "DBC", "GLD", "IEF", "TLT"];
      if (!isMonthEnd(u, t) || !has(u, e.tickers, t, YEAR + 1)) return null;
      const m = (x: string) => m13612w(c(u, x), t)!;
      const good = ["VWO", "BND"].filter((x) => m(x) > 0).length;
      const share = good === 2 ? 1 : good === 1 ? 0.5 : 0;
      const rest = m("IEF") > 0 ? "IEF" : "BIL";
      if (share === 0) return { [rest]: 1 };
      const picks = top(pool, p, m);
      const r21 = returnsBefore(
        picks.map((x) => c(u, x)),
        t + 1,
        21,
      );
      const r252 = returnsBefore(
        picks.map((x) => c(u, x)),
        t + 1,
        252,
      );
      const vol = r21.map((x) => sd(x));
      const cov252 = covariance(r252);
      const s252 = cov252.map((row, i) => Math.sqrt(row[i]));
      const cov = cov252.map((row, i) =>
        row.map((v, j) => (v / (s252[i] * s252[j])) * vol[i] * vol[j]),
      );
      const mv = minVariance(cov, 1);
      const w: Weights = {};
      picks.forEach((f, i) => add(w, f, share * mv[i]));
      if (share < 1) add(w, rest, 1 - share);
      return w;
    }
    case "watch_blend":
    case "haa_no_brainer": {
      if (!isMonthEnd(u, t)) return null;
      const fresh = (): Context => ({ value: ctx.value, held: {}, memo: {} });
      const parts =
        id === "watch_blend"
          ? [
              decide("haa", 4, u, t, fresh()),
              decide("eaa", 2, u, t, fresh()),
              decide("faber_gtaa_top", 3, u, t, fresh()),
            ]
          : [decide("haa", 4, u, t, fresh()), decide("no_brainer", 0, u, t, fresh())];
      if (parts.some((x) => x === null)) return null;
      const w: Weights = {};
      for (const part of parts as Weights[])
        for (const [x, v] of Object.entries(part)) add(w, x, v / parts.length);
      return w;
    }
    case "mix_trend_overlay":
    case "mix_momentum_overlay": {
      // One of the mix's funds at a time (ctx.memo.fund, set by the engine): it, or bills.
      const fund = OVERLAY_FUNDS[ctx.memo.fund ?? 0];
      const back = p * MONTH;
      if (!isMonthEnd(u, t) || !has(u, [fund, "BIL"], t, back)) return null;
      const on =
        id === "mix_trend_overlay"
          ? c(u, fund)[t] > sma(c(u, fund), t, back)!
          : ret(c(u, fund), t, back)! > ret(c(u, "BIL"), t, back)!;
      return { [on ? fund : "BIL"]: 1 };
    }
    case "adaptive_aa": {
      if (!isMonthEnd(u, t) || !has(u, TEN, t, 251)) return null;
      const picks = top([...TEN], p, (x) => ret(c(u, x), t, 6 * MONTH)!);
      // Volatility from the last 60 days, correlation from the last 250: their covariance.
      const r60 = returnsBefore(
        picks.map((x) => c(u, x)),
        t + 1,
        60,
      );
      const r250 = returnsBefore(
        picks.map((x) => c(u, x)),
        t + 1,
        250,
      );
      const vol = r60.map((r) => sd(r));
      const cov250 = covariance(r250);
      const s250 = cov250.map((row, i) => Math.sqrt(row[i]));
      const cov = cov250.map((row, i) =>
        row.map((v, j) => (v / (s250[i] * s250[j])) * vol[i] * vol[j]),
      );
      const w = minVariance(cov, 1);
      return Object.fromEntries(picks.map((x, i) => [x, w[i]]));
    }
    case "risk_parity": {
      const funds = ["VTI", "TLT", "IEF", "GLD", "DBC"];
      if (!isMonthEnd(u, t) || !has(u, funds, t, p + 1)) return null;
      const r = returnsBefore(
        funds.map((x) => c(u, x)),
        t + 1,
        p,
      );
      const inv = r.map((x) => 1 / Math.max(1e-6, sd(x)));
      const s = inv.reduce((a, x) => a + x, 0);
      return Object.fromEntries(funds.map((x, i) => [x, inv[i] / s]));
    }
    case "min_variance":
      return optimized(u, t, TEN, p, "min");
    case "max_diversification":
      return optimized(u, t, TEN, p, "maxdiv");
    case "hrp":
      return optimized(u, t, TEN, p, "hrp");
    case "value":
    case "momentum":
    case "quality":
    case "low_volatility":
    case "size":
    case "small_value":
    case "equal_weight":
    case "dividend_growth":
    case "shareholder_yield":
    case "managed_futures":
      return fixed(u, t, { [e.tickers[0]]: 1 });
    case "multi_factor":
      return fixed(u, t, equal(e.tickers));
    case "sector_rotation": {
      if (!isMonthEnd(u, t) || !has(u, SECTORS, t, p * MONTH)) return null;
      return equal(top([...SECTORS], 3, (x) => ret(c(u, x), t, p * MONTH)!));
    }
    case "sector_trend": {
      if (!isMonthEnd(u, t) || !has(u, [...SECTORS, "BIL"], t, YEAR)) return null;
      const w: Weights = {};
      for (const f of top([...SECTORS], p, (x) => m13612u(c(u, x), t)!))
        add(w, c(u, f)[t] > sma(c(u, f), t, 10 * MONTH)! ? f : "BIL", 1 / p);
      return w;
    }
    case "trend_vol": {
      if (!isWeekEnd(u, t) || !has(u, ["SPY", "BIL"], t, 200)) return null;
      const spy = c(u, "SPY");
      if (spy[t] <= sma(spy, t, 200)!) return { BIL: 1 };
      const [r] = returnsBefore([spy], t + 1, 20);
      const w = Math.min(1, p / Math.max(1e-6, sd(r) * Math.sqrt(252)));
      return { SPY: w, BIL: 1 - w };
    }
    case "bond_rotation": {
      if (!isMonthEnd(u, t) || !has(u, e.tickers, t, p * MONTH)) return null;
      const r = (x: string) => ret(c(u, x), t, p * MONTH)!;
      const best = top(["TLT", "IEF", "SHY", "LQD", "HYG", "TIP"], 1, r)[0];
      return { [r(best) > r("BIL") ? best : "BIL"]: 1 };
    }
    case "trend_200": {
      if (!isMonthEnd(u, t) || !has(u, ["SPY", "BIL"], t, p)) return null;
      return { [c(u, "SPY")[t] > sma(c(u, "SPY"), t, p)! ? "SPY" : "BIL"]: 1 };
    }
    case "time_series_momentum": {
      if (!isMonthEnd(u, t) || !has(u, ["SPY", "BIL"], t, p * MONTH)) return null;
      const r = (x: string) => ret(c(u, x), t, p * MONTH)!;
      return { [r("SPY") > r("BIL") ? "SPY" : "BIL"]: 1 };
    }
    case "vol_target": {
      if (!isWeekEnd(u, t) || !has(u, ["SPY", "BIL"], t, 21)) return null;
      const [r] = returnsBefore([c(u, "SPY")], t + 1, 20);
      const vol = sd(r) * Math.sqrt(252);
      const w = Math.min(1, p / Math.max(1e-6, vol));
      return { SPY: w, BIL: 1 - w };
    }
    case "cppi":
    case "tipp": {
      if (!has(u, ["SPY", "BIL"], t, 0)) return null;
      const year = u.dates[t].slice(0, 4);
      if (id === "cppi") {
        if (ctx.memo.year !== Number(year)) {
          ctx.memo.year = Number(year);
          ctx.memo.floor = 0.8 * ctx.value;
        }
      } else {
        ctx.memo.floor = Math.max(ctx.memo.floor ?? 0, 0.8 * ctx.value);
      }
      if (!isWeekEnd(u, t) && Object.keys(ctx.held).length > 0) return null;
      const cushion = Math.max(0, ctx.value - ctx.memo.floor);
      const w = Math.min(1, (p * cushion) / ctx.value);
      return { SPY: w, BIL: 1 - w };
    }
    case "sell_in_may": {
      if (!has(u, ["SPY", "BIL"], t, 0)) return null;
      // Decided at the close before the month it is for.
      const next =
        t + 1 < u.dates.length
          ? Number(u.dates[t + 1].slice(5, 7))
          : Number(u.dates[t].slice(5, 7));
      const want = next >= 5 && next <= 10 ? "BIL" : "SPY";
      return ctx.held[want] === 1 ? null : { [want]: 1 };
    }
    case "turn_of_month": {
      if (!has(u, ["SPY", "BIL"], t, 0)) return null;
      // In from the last trading day's close through the Nth trading day's close of the next.
      const month = u.dates[t].slice(0, 7);
      let dayOfMonth = 1;
      for (let i = t - 1; i >= 0 && u.dates[i].slice(0, 7) === month; i -= 1) dayOfMonth += 1;
      const want = isMonthEnd(u, t) || dayOfMonth < p ? "SPY" : "BIL";
      return ctx.held[want] === 1 ? null : { [want]: 1 };
    }
    case "rsi2": {
      if (!has(u, ["SPY", "BIL"], t, 200)) return null;
      const spy = c(u, "SPY");
      const inSpy = (ctx.held.SPY ?? 0) > 0;
      if (!inSpy && spy[t] > sma(spy, t, 200)! && rsi(spy, t, 2)! < p) return { SPY: 1 };
      if (inSpy && spy[t] > sma(spy, t, 5)!) return { BIL: 1 };
      return Object.keys(ctx.held).length === 0 ? { BIL: 1 } : null;
    }
    case "ibs": {
      const bar = u.spy?.[t];
      if (!bar || !has(u, ["SPY", "BIL"], t, 0)) return null;
      const range = bar.h - bar.l;
      const ibs = range > 0 ? (bar.c - bar.l) / range : 0.5;
      const want = ibs < p ? "SPY" : "BIL";
      return ctx.held[want] === 1 ? null : { [want]: 1 };
    }
    case "bollinger": {
      if (!has(u, ["SPY", "BIL"], t, 200)) return null;
      const spy = c(u, "SPY");
      const mid = sma(spy, t, 20)!;
      const band = sd(spy.slice(t - 19, t + 1));
      const inSpy = (ctx.held.SPY ?? 0) > 0;
      if (!inSpy && spy[t] > sma(spy, t, 200)! && spy[t] < mid - p * band) return { SPY: 1 };
      if (inSpy && spy[t] > mid) return { BIL: 1 };
      return Object.keys(ctx.held).length === 0 ? { BIL: 1 } : null;
    }
  }
}
