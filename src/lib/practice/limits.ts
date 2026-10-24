import type { AutopilotLimits } from "@/config/portfolios";
import type { LedgerState } from "@/planning/practice-ledger";
import { heldBy } from "@/planning/practice-scan";

// The practice portfolio's hard limits on a set of trades (Phase AW, Stage A), shared by the
// daily scan (./scan.ts, through flagStatus), a Yes on a practice idea (./ideas.ts) and the rule
// replay (src/planning/rule-replay.ts). Pure: no database. One rule: heldBy in
// src/planning/practice-scan.ts.

// Whether trades, one after another, all keep the hard limits; the first broken one.
export function tradesHeldBy(
  trades: readonly { ticker: string; side: "buy" | "sell"; amountCents: number }[],
  state: LedgerState,
  prices: Readonly<Record<string, number>>,
  tradesToday: number,
  // The person's limits; the hard ones without them.
  limits?: AutopilotLimits,
): string | null {
  return heldBy({ trades }, state, prices, tradesToday, limits);
}
