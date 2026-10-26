import { TARGET_MIXES, type RiskLevel } from "@/config/investing";
import {
  CRYPTO_TICKERS,
  DAY_TRADE_TICKER,
  PRACTICE_STOCKS,
  THEME_FUNDS,
  type AutopilotLimits,
} from "@/config/portfolios";
import {
  CATALOG,
  CATALOG_MIX_FUNDS,
  OVERLAY_FUNDS,
  type CatalogId,
} from "@/config/strategy-catalog";
import { covariance, returnsBefore } from "./catalog/math";
import { decide, type Universe, type Weights } from "./catalog/strategies";
import {
  portfolioValue,
  positionValue,
  withinHard,
  type PlannedTrade,
  type Prices,
} from "./practice-autopilot";
import type { LedgerState } from "./practice-ledger";

// Following a tested strategy in the practice portfolio (Phase AW, Stage A): the catalog's own
// rule (src/planning/catalog/strategies.ts, the code the research replayed) decides at the
// last month-end before today, and the portfolio is rebalanced to it. Whole portfolios are
// blended with bills so their volatility over the last year matches the level's mix (never
// levered); equity strategies take the mix's US-stocks share; overlays rule over the mix fund
// by fund. Pure. Practice money only.

export const CATALOG_FOLLOW_BAND = 0.02;
const YEAR = 252;

function mixOf(level: RiskLevel): Weights {
  const m = TARGET_MIXES[level];
  return {
    [CATALOG_MIX_FUNDS.us_stocks]: m.us_stocks,
    [CATALOG_MIX_FUNDS.intl_stocks]: m.intl_stocks,
    [CATALOG_MIX_FUNDS.bonds]: m.bonds,
    [CATALOG_MIX_FUNDS.cash]: m.cash,
  };
}

// Volatility a year of fixed weights over the year before index t.
function volOf(u: Universe, w: Weights, t: number): number | null {
  const tickers = Object.keys(w).filter((x) => w[x] > 0);
  if (tickers.some((x) => (u.closes[x]?.[t - YEAR] ?? 0) <= 0)) return null;
  const cov = covariance(
    returnsBefore(
      tickers.map((x) => u.closes[x]),
      t + 1,
      YEAR,
    ),
  );
  let v = 0;
  tickers.forEach((a, i) => tickers.forEach((b, j) => (v += w[a] * w[b] * cov[i][j])));
  return Math.sqrt(Math.max(0, v) * YEAR);
}

export type FollowTargets = { targets: Weights; signalDate: string; k: number };

// The shares of the whole portfolio the strategy holds this month, or null when the prices
// don't yet reach far enough back.
export function catalogTargets(
  id: CatalogId,
  param: number,
  u: Universe,
  level: RiskLevel,
): FollowTargets | null {
  const last = u.dates.length - 1;
  if (last < 1) return null;
  const month = u.dates[last].slice(0, 7);
  // The last trading day of the month before (the rule's own decision day).
  let t = last;
  while (t >= 0 && u.dates[t].slice(0, 7) === month) t -= 1;
  if (t < YEAR) return null;
  const view: Universe = {
    ...u,
    dates: u.dates.slice(0, t + 2),
    closes: Object.fromEntries(Object.entries(u.closes).map(([x, c]) => [x, c.slice(0, t + 2)])),
  };
  const kind = CATALOG[id].kind;
  const mix = mixOf(level);
  if (kind === "overlay") {
    const targets: Weights = { [CATALOG_MIX_FUNDS.cash]: mix[CATALOG_MIX_FUNDS.cash] };
    for (const [f, fund] of OVERLAY_FUNDS.entries()) {
      const w = decide(id, param, view, t, { value: 1, held: {}, memo: { fund: f } });
      if (!w) return null;
      const on = (w[fund] ?? 0) > 0;
      const k = on ? fund : CATALOG_MIX_FUNDS.cash;
      targets[k] = (targets[k] ?? 0) + mix[fund];
    }
    return { targets, signalDate: u.dates[t], k: 1 };
  }
  const w = decide(id, param, view, t, { value: 1, held: {}, memo: {} });
  if (!w) return null;
  if (kind === "equity") {
    const us = mix[CATALOG_MIX_FUNDS.us_stocks];
    const targets: Weights = Object.fromEntries(
      Object.entries(mix).filter(([x]) => x !== CATALOG_MIX_FUNDS.us_stocks),
    );
    for (const [x, v] of Object.entries(w)) targets[x] = (targets[x] ?? 0) + us * v;
    return { targets, signalDate: u.dates[t], k: 1 };
  }
  const mixVol = volOf(u, mix, t);
  const ownVol = volOf(u, w, t);
  const k = mixVol !== null && ownVol !== null && ownVol > 0 ? Math.min(1, mixVol / ownVol) : 1;
  const targets: Weights = {};
  for (const [x, v] of Object.entries(w)) targets[x] = (targets[x] ?? 0) + k * v;
  if (k < 1) targets[CATALOG_MIX_FUNDS.cash] = (targets[CATALOG_MIX_FUNDS.cash] ?? 0) + (1 - k);
  return { targets, signalDate: u.dates[t], k };
}

// What the follow leaves alone: a company's shares, a news theme's slice, the crypto and
// day-trading sleeves.
const outside = (x: string) =>
  (PRACTICE_STOCKS as readonly string[]).includes(x) ||
  CRYPTO_TICKERS.includes(x) ||
  x === DAY_TRADE_TICKER;

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

// The trades that bring the portfolio to the targets: whatever of the mix's or the strategy's
// funds isn't a target is sold; each target more than CATALOG_FOLLOW_BAND off is traded back,
// sells first, buys from the cash they free; within the hard limits (one fund at most
// perEtfShare, bills excepted; each trade at most perTradeShare; trades a day).
export function planTargets(input: {
  label: string;
  targets: Weights;
  signalDate: string;
  state: LedgerState;
  prices: Prices;
  cashBufferCents: number;
  tradesToday: number;
  limits?: AutopilotLimits;
}): PlannedTrade[] {
  const L = withinHard(input.limits);
  const { state, prices } = input;
  const total = portfolioValue(state, prices);
  if (total <= 0) return [];
  const investable = Math.max(0, total - Math.max(0, input.cashBufferCents));
  // Capped targets: what a cap keeps out of a fund waits in bills.
  const targets: Weights = {};
  let spill = 0;
  for (const [x, v] of Object.entries(input.targets)) {
    const cap = x === CATALOG_MIX_FUNDS.cash ? 1 : L.perEtfShare;
    targets[x] = Math.min(v, cap);
    spill += v - targets[x];
  }
  if (spill > 0) targets[CATALOG_MIX_FUNDS.cash] = (targets[CATALOG_MIX_FUNDS.cash] ?? 0) + spill;
  const held = (x: string) => positionValue(state, prices, x);
  const band = Math.max(L.minTradeCents, Math.round(CATALOG_FOLLOW_BAND * total));
  const gaps: { ticker: string; gap: number }[] = [];
  for (const x of Object.keys(state.positions))
    if (!(x in targets) && !outside(x) && !THEME_FUNDS.includes(x) && held(x) > 0)
      gaps.push({ ticker: x, gap: -held(x) });
  for (const [x, v] of Object.entries(targets)) {
    if (!prices[x]) continue;
    const gap = Math.round(v * investable) - held(x);
    if (Math.abs(gap) >= band) gaps.push({ ticker: x, gap });
  }
  const out: PlannedTrade[] = [];
  let cash = state.cashCents - Math.max(0, input.cashBufferCents);
  const room = () => input.tradesToday + out.length < L.tradesPerDay;
  const perTrade = Math.round(L.perTradeShare * total);
  for (const g of gaps.filter((x) => x.gap < 0).sort((a, b) => a.gap - b.gap)) {
    if (!room()) break;
    const amount = Math.min(-g.gap, held(g.ticker), perTrade);
    if (amount < L.minTradeCents) continue;
    out.push({
      ticker: g.ticker,
      side: "sell",
      amountCents: amount,
      rule: "catalog_follow",
      reason:
        g.ticker in targets
          ? `Following ${input.label}: ${g.ticker} back down to ${pct(targets[g.ticker])} of the portfolio, as its rule said at the close on ${input.signalDate}.`
          : `Following ${input.label}: out of ${g.ticker}, which its rule doesn't hold this month (decided at the close on ${input.signalDate}).`,
    });
    cash += amount;
  }
  for (const g of gaps.filter((x) => x.gap > 0).sort((a, b) => b.gap - a.gap)) {
    if (!room()) break;
    const amount = Math.min(g.gap, cash, perTrade);
    if (amount < L.minTradeCents) continue;
    out.push({
      ticker: g.ticker,
      side: "buy",
      amountCents: amount,
      rule: "catalog_follow",
      reason: `Following ${input.label}: ${g.ticker} up to ${pct(targets[g.ticker])} of the portfolio, as its rule said at the close on ${input.signalDate}.`,
    });
    cash -= amount;
  }
  return out;
}
