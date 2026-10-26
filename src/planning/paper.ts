import { TARGET_MIXES, type RiskLevel } from "@/config/investing";
import { CATALOG_MIX_FUNDS } from "@/config/strategy-catalog";
import { apply, value, type LedgerState } from "./practice-ledger";

// The paper account's arithmetic (src/lib/paper/): the trades that bring an account to its
// strategy's targets, filling and reverting them, and just holding the level's mix to compare
// with. Pure. It uses the practice ledger's rules (no borrowing, no shorting); simulated only.

export type Weights = Readonly<Record<string, number>>;
export type Prices = Readonly<Record<string, number>>;
export type PaperOrder = { ticker: string; side: "buy" | "sell"; amountCents: number };

// The level's plain mix by fund (bills as its cash).
export function mixWeights(level: RiskLevel): Record<string, number> {
  const m = TARGET_MIXES[level];
  return {
    [CATALOG_MIX_FUNDS.us_stocks]: m.us_stocks,
    [CATALOG_MIX_FUNDS.intl_stocks]: m.intl_stocks,
    [CATALOG_MIX_FUNDS.bonds]: m.bonds,
    [CATALOG_MIX_FUNDS.cash]: m.cash,
  };
}

// The trades toward the targets: a fund more than `band` of the account off its target (and at
// least minTradeCents) is traded back; a fund the targets don't hold is sold. Sells first, then
// buys from the cash there is, biggest gap first. Funds without a price are left alone.
export function ordersToward(
  targets: Weights,
  state: LedgerState,
  prices: Prices,
  { band, minTradeCents }: { band: number; minTradeCents: number },
): PaperOrder[] {
  const total = value(state, prices);
  if (total <= 0) return [];
  const threshold = Math.max(minTradeCents, Math.round(band * total));
  const held = (t: string) => Math.round((state.positions[t]?.quantity ?? 0) * (prices[t] ?? 0));
  const tickers = [...new Set([...Object.keys(targets), ...Object.keys(state.positions)])].filter(
    (t) => (prices[t] ?? 0) > 0,
  );
  const sells: PaperOrder[] = [];
  const buys: { ticker: string; gap: number }[] = [];
  for (const t of tickers.sort()) {
    const want = Math.round((targets[t] ?? 0) * total);
    const gap = want - held(t);
    if (!(t in targets) && held(t) > 0)
      sells.push({ ticker: t, side: "sell", amountCents: held(t) });
    else if (gap <= -threshold)
      sells.push({ ticker: t, side: "sell", amountCents: Math.min(-gap, held(t)) });
    else if (gap >= threshold) buys.push({ ticker: t, gap });
  }
  let cash = state.cashCents + sells.reduce((a, s) => a + s.amountCents, 0);
  const out = [...sells];
  for (const b of buys.sort((x, y) => y.gap - x.gap)) {
    const amount = Math.min(b.gap, cash);
    if (amount < minTradeCents) continue;
    out.push({ ticker: b.ticker, side: "buy", amountCents: amount });
    cash -= amount;
  }
  return out;
}

// A trade filled at its price, by the ledger's rules.
export function fill(state: LedgerState, order: PaperOrder, priceCents: number) {
  return apply(
    state,
    { side: order.side, ticker: order.ticker, amountCents: order.amountCents, priceCents },
    new Set([order.ticker.toUpperCase()]),
  );
}

// A trade taken back: the opposite trade at the same price, so the cash and the shares come back
// exactly (the cost basis by the ledger's average).
export function revert(state: LedgerState, trade: PaperOrder & { priceCents: number }) {
  return fill(
    state,
    {
      ticker: trade.ticker,
      side: trade.side === "buy" ? "sell" : "buy",
      amountCents: trade.amountCents,
    },
    trade.priceCents,
  );
}

// Just holding: the starting money in the level's mix at the start's prices, never traded.
export function holdUnits(level: RiskLevel, startingCents: number, prices: Prices) {
  return Object.fromEntries(
    Object.entries(mixWeights(level)).flatMap(([t, w]) =>
      (prices[t] ?? 0) > 0 ? [[t, (w * startingCents) / prices[t]]] : [],
    ),
  ) as Record<string, number>;
}

export function holdValue(units: Readonly<Record<string, number>>, prices: Prices): number {
  return Object.entries(units).reduce((a, [t, q]) => a + Math.round(q * (prices[t] ?? 0)), 0);
}

export { value };
