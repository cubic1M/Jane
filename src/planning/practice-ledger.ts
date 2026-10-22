// The practice (paper) ledger (spec step 290, Phase AW, Stage A). Pure: a portfolio's state and
// the rules every trade must keep. It is practice money only: no leverage (cash never goes
// negative), no shorting (you cannot sell what you don't hold), no options (only whole-market
// tickers the market data knows are allowed, bought and sold outright). The state always
// balances to the cent, and can be rebuilt from the trades.

export type Position = { quantity: number; costBasisCents: number };
export type LedgerState = {
  cashCents: number;
  positions: Readonly<Record<string, Position>>;
};

export type Entry =
  | { side: "deposit"; amountCents: number }
  | { side: "buy"; ticker: string; amountCents: number; priceCents: number }
  | { side: "sell"; ticker: string; amountCents: number; priceCents: number };

export class LedgerError extends Error {}

export type Applied = { state: LedgerState; quantity: number | null; gainCents: number | null };

export function apply(state: LedgerState, entry: Entry, allowed: ReadonlySet<string>): Applied {
  if (!Number.isInteger(entry.amountCents) || entry.amountCents <= 0) {
    throw new LedgerError("An amount is a whole number of cents above zero.");
  }
  if (entry.side === "deposit") {
    return {
      state: { ...state, cashCents: state.cashCents + entry.amountCents },
      quantity: null,
      gainCents: null,
    };
  }
  const ticker = entry.ticker.toUpperCase();
  if (!allowed.has(ticker))
    throw new LedgerError(`${ticker} isn't something the practice portfolio holds.`);
  if (!Number.isInteger(entry.priceCents) || entry.priceCents <= 0) {
    throw new LedgerError("A trade needs a price.");
  }
  const quantity = entry.amountCents / entry.priceCents;
  const held = state.positions[ticker] ?? { quantity: 0, costBasisCents: 0 };
  if (entry.side === "buy") {
    if (entry.amountCents > state.cashCents)
      throw new LedgerError("Not enough cash: no borrowing in a practice portfolio.");
    return {
      state: {
        cashCents: state.cashCents - entry.amountCents,
        positions: {
          ...state.positions,
          [ticker]: {
            quantity: held.quantity + quantity,
            costBasisCents: held.costBasisCents + entry.amountCents,
          },
        },
      },
      quantity,
      gainCents: null,
    };
  }
  // Selling: no more than is held; a sale of everything takes the whole cost. Amounts are whole
  // cents, so a sale within a cent of everything held is all of it.
  const tolerance = Math.max(1e-9 * Math.max(1, held.quantity), 1 / entry.priceCents);
  if (quantity > held.quantity + tolerance)
    throw new LedgerError(`You don't hold that much ${ticker}: no selling short.`);
  const all = Math.abs(quantity - held.quantity) <= tolerance;
  const sold = all ? held.quantity : quantity;
  const costRemoved = all
    ? held.costBasisCents
    : Math.round((held.costBasisCents * sold) / held.quantity);
  const rest = { ...state.positions };
  if (all) delete rest[ticker];
  else
    rest[ticker] = {
      quantity: held.quantity - sold,
      costBasisCents: held.costBasisCents - costRemoved,
    };
  return {
    state: { cashCents: state.cashCents + entry.amountCents, positions: rest },
    quantity: sold,
    gainCents: entry.amountCents - costRemoved,
  };
}

// The state rebuilt from a starting amount and the entries, in order.
export function replay(
  startingCents: number,
  entries: readonly Entry[],
  allowed: ReadonlySet<string>,
): LedgerState {
  return entries.reduce<LedgerState>((s, e) => apply(s, e, allowed).state, {
    cashCents: startingCents,
    positions: {},
  });
}

// What the portfolio is worth at these prices (cents per share, by ticker).
export function value(state: LedgerState, prices: Readonly<Record<string, number>>): number {
  return (
    state.cashCents +
    Object.entries(state.positions).reduce(
      (s, [t, p]) => s + Math.round(p.quantity * (prices[t] ?? 0)),
      0,
    )
  );
}

// The ledger balances when cash plus what was paid for the positions equals what went in less
// what has been taken out as gains: the cash and cost bases can be checked against the entries.
export function balances(
  startingCents: number,
  entries: readonly Entry[],
  state: LedgerState,
): boolean {
  const deposits = entries.reduce((s, e) => s + (e.side === "deposit" ? e.amountCents : 0), 0);
  const buys = entries.reduce((s, e) => s + (e.side === "buy" ? e.amountCents : 0), 0);
  const sells = entries.reduce((s, e) => s + (e.side === "sell" ? e.amountCents : 0), 0);
  return state.cashCents === startingCents + deposits - buys + sells;
}
