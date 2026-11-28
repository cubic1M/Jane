import { LEGACY_POSTED_DAYS, TWIN_DATE_SLACK_DAYS } from "@/config/plaid";

// A pending charge of the old link that the new link had not listed when the accounts moved over is kept
// (src/lib/plaid/replace.ts), under an id with this prefix. Plaid does not say that a transaction id is
// the same on a second Item of the same bank (plaid.com/docs/api/products/transactions/, read 2026-11-28:
// it is only "the unique ID of the transaction"), so the new link's later posted charge cannot find the
// row by its pending_transaction_id: it is found here, by account, words and amount.
export const LEGACY_PENDING_PREFIX = "legacy-pending:";

const DAY_MS = 86_400_000;
const POSTED_SLACK_DAYS = 7;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export type Ghost = {
  id: string;
  accountId: string;
  date: Date;
  amountCents: number;
  description: string;
};

export type Arrival = {
  plaidTransactionId: string;
  accountId: string;
  date: Date;
  amountCents: number;
  description: string;
  pending: boolean;
  // Plaid's pending_transaction_id of a posted charge.
  pendingExternalId: string | null;
};

// For each new row, the kept pending row of the old link it is: a new pending charge of the same account
// and amount a few days apart, or a posted charge that says it replaced a pending one, of the same words
// (an amount within a third: a tip) a week either side. One for one, the nearest first.
export function adoptLegacyPending(
  ghosts: readonly Ghost[],
  arrivals: readonly Arrival[],
): Map<string, string> {
  const pairs: { key: string; ghost: string; days: number }[] = [];
  for (const a of arrivals) {
    for (const g of ghosts) {
      if (g.accountId !== a.accountId) continue;
      const days = Math.abs(g.date.getTime() - a.date.getTime()) / DAY_MS;
      // The same words either way: a different purchase of the same amount is its own row.
      if (words(g.description) !== words(a.description)) continue;
      const fits = a.pending
        ? g.amountCents === a.amountCents && days <= TWIN_DATE_SLACK_DAYS
        : a.pendingExternalId !== null &&
          days <= POSTED_SLACK_DAYS &&
          Math.abs(g.amountCents - a.amountCents) <= Math.abs(a.amountCents) / 3;
      if (fits) pairs.push({ key: a.plaidTransactionId, ghost: g.id, days });
    }
  }
  pairs.sort(
    (x, y) => x.days - y.days || x.key.localeCompare(y.key) || x.ghost.localeCompare(y.ghost),
  );
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const p of pairs) {
    if (out.has(p.key) || taken.has(p.ghost)) continue;
    out.set(p.key, p.ghost);
    taken.add(p.ghost);
  }
  // A posted charge that names a pending predecessor, worded differently (AMZN MKTP against AMAZON
  // MARKETPLACE): the same account and amount, the only candidate within LEGACY_POSTED_DAYS, and the kept
  // row has no other candidate. With two candidates both are left and the ten-day rule cleans the stale one.
  const spare = ghosts.filter((g) => !taken.has(g.id));
  const loose = arrivals.filter(
    (a) => !a.pending && a.pendingExternalId !== null && !out.has(a.plaidTransactionId),
  );
  const near = (a: Arrival, g: Ghost) =>
    g.accountId === a.accountId &&
    g.amountCents === a.amountCents &&
    Math.abs(g.date.getTime() - a.date.getTime()) / DAY_MS <= LEGACY_POSTED_DAYS;
  for (const a of loose) {
    const cands = spare.filter((g) => near(a, g));
    if (cands.length !== 1) continue;
    const g = cands[0];
    if (loose.filter((b) => near(b, g)).length !== 1) continue;
    out.set(a.plaidTransactionId, g.id);
  }
  return out;
}
