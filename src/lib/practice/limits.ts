import { PRACTICE_UNIVERSE } from "@/config/portfolios";
import { violates } from "@/planning/practice-autopilot";
import { apply, LedgerError, type LedgerState } from "@/planning/practice-ledger";

// The practice portfolio's hard limits on a set of trades (Phase AW, Stage A), shared by the
// daily scan (./scan.ts) and a Yes on a practice idea (./ideas.ts). Pure: no database.

// Whether trades, one after another, all keep the hard limits; the first broken one.
export function tradesHeldBy(
  trades: readonly { ticker: string; side: "buy" | "sell"; amountCents: number }[],
  state: LedgerState,
  prices: Readonly<Record<string, number>>,
  tradesToday: number,
): string | null {
  let s = state;
  let n = tradesToday;
  for (const t of trades) {
    const why = violates(t, s, prices, n);
    if (why) return why;
    const priceCents = prices[t.ticker];
    if (!priceCents) return `no price for ${t.ticker}`;
    const entry = { side: t.side, ticker: t.ticker, amountCents: t.amountCents, priceCents };
    try {
      s = apply(s, entry, PRACTICE_UNIVERSE).state;
    } catch (error) {
      if (error instanceof LedgerError) return error.message;
      throw error;
    }
    n += 1;
  }
  return null;
}
