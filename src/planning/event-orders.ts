import { CATALOG_MIX_FUNDS } from "@/config/strategy-catalog";
import type { EventSlice, Prices, Weights } from "./event-overlay";
import { value, type PaperOrder } from "./paper";
import type { LedgerState } from "./practice-ledger";

// The paper trades for one events-overlay slice (src/lib/events/run.ts), pure. Opening a bought
// slice: paid for from cash first, then by selling the strategy's own funds in proportion to its
// mix. Closing it: its own units sold, and the money put back into the mix the same way. A trim
// moves part of a held fund to cash, and back when it closes. Sells come before buys, so a buy
// never needs cash the account doesn't have. No borrowing, no shorting: every sell is at most
// what is held.

const held = (state: LedgerState, prices: Prices, t: string) =>
  Math.floor((state.positions[t]?.quantity ?? 0) * (prices[t] ?? 0));

// `amount` spread over the mix's funds that have a price (and, for sells, what is held), in
// proportion to their weights. The last takes the rounding.
function spread(
  amount: number,
  base: Weights,
  prices: Prices,
  side: "buy" | "sell",
  state: LedgerState,
  skip: string,
): PaperOrder[] {
  const funds = Object.entries(base).filter(
    ([t, w]) =>
      t !== skip && w > 0 && (prices[t] ?? 0) > 0 && (side === "buy" || held(state, prices, t) > 0),
  );
  const total = funds.reduce((a, [, w]) => a + w, 0);
  if (total <= 0 || amount <= 0) return [];
  const out: PaperOrder[] = [];
  let left = amount;
  funds.forEach(([t, w], i) => {
    let part = i === funds.length - 1 ? left : Math.round((amount * w) / total);
    if (side === "sell") part = Math.min(part, held(state, prices, t));
    part = Math.min(part, left);
    if (part <= 0) return;
    out.push({ ticker: t, side, amountCents: part });
    left -= part;
  });
  return out;
}

const merge = (orders: PaperOrder[], minTradeCents: number) =>
  orders.filter((o) => o.amountCents >= minTradeCents);

export function openOrders(
  slice: Pick<EventSlice, "ticker" | "side" | "tilt">,
  state: LedgerState,
  prices: Prices,
  base: Weights,
  minTradeCents: number,
): PaperOrder[] {
  const total = value(state, prices);
  const want = Math.round(slice.tilt * total);
  if (slice.side === "trim") {
    const amount = Math.min(want, held(state, prices, slice.ticker));
    return merge(
      [
        { ticker: slice.ticker, side: "sell", amountCents: amount },
        { ticker: CATALOG_MIX_FUNDS.cash, side: "buy", amountCents: amount },
      ],
      minTradeCents,
    );
  }
  const fromCash = Math.min(state.cashCents, want);
  const sells = spread(want - fromCash, base, prices, "sell", state, slice.ticker);
  const raised = sells.reduce((a, s) => a + s.amountCents, 0);
  return merge(
    [...sells, { ticker: slice.ticker, side: "buy", amountCents: fromCash + raised }],
    minTradeCents,
  );
}

// Closing: the slice's own units (what it bought, or for a trim the cash fund it bought), at most
// what is held.
export function closeOrders(
  slice: Pick<EventSlice, "ticker" | "side" | "units">,
  state: LedgerState,
  prices: Prices,
  base: Weights,
  minTradeCents: number,
): PaperOrder[] {
  const fund = slice.side === "trim" ? CATALOG_MIX_FUNDS.cash : slice.ticker;
  const amount = Math.min(
    Math.floor((slice.units ?? 0) * (prices[fund] ?? 0)),
    held(state, prices, fund),
  );
  if (amount <= 0) return [];
  const sell: PaperOrder = { ticker: fund, side: "sell", amountCents: amount };
  const buys =
    slice.side === "trim"
      ? [{ ticker: slice.ticker, side: "buy" as const, amountCents: amount }]
      : spread(amount, base, prices, "buy", state, slice.ticker);
  return merge([sell, ...buys], minTradeCents);
}
