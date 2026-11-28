import { REREAD_MAX_POSTED_REMOVALS, REREAD_MAX_POSTED_SHARE } from "@/config/plaid";
import type { PrismaClient } from "@/generated/prisma/client";
import { personTransaction } from "@/lib/db-scoped";
import { lockLiveItem } from "@/lib/plaid/live-item";

// A read from an empty cursor lists the Item's whole current set as "added" and carries no
// "removed" entries; a cursor saved after it skips every removal that happened before it. So a
// pending hold the bank dropped, or a charge it reissued under a new id, since the last ordinary
// sync would stay in Jane for good (16 rows held where Plaid lists 14: the walker's proof, #2406).
//
// Plaid's docs (https://plaid.com/docs/api/products/transactions/, read 2026-11-28): the cursor
// field says "If omitted, the entire history of updates will be returned, starting with the
// first-added transactions on the Item."; pagination says "it's important to pull all available
// pages"; after TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION "the entire pagination request loop
// must be restarted". The docs do not say whether `removed` can appear on a call without a cursor
// (https://plaid.com/docs/transactions/sync-migration/ only calls removals "patches"), so a read
// from the start is trusted for what it lists, not for what it leaves unsaid.
//
// So, once a read from the start has finished (every page read; PlaidDataSource throws on a
// partial read, and a restart is a whole new read), every row held for the link's accounts from
// Plaid whose id the set lacks is one Plaid dropped. It goes through deleteRemoved, the code the
// ordinary sync deletes a "removed" entry with.

type DeleteMany = {
  deleteMany(args: {
    where: { plaidTransactionId: { in: string[] }; userId: string; updatedAt?: { lt: Date } };
  }): PromiseLike<{ count: number }>;
};

// Deletes rows by Plaid transaction id: the ordinary sync's "removed" entries and the read from
// the start's dropped rows both come here.
export async function deleteRemoved(
  transactions: DeleteMany,
  userId: string,
  ids: readonly string[],
  // The read from the start passes the day it began: a row changed since is left alone, checked in
  // the same statement as the delete.
  unchangedSince?: Date,
): Promise<number> {
  if (ids.length === 0) return 0;
  const { count } = await transactions.deleteMany({
    where: {
      plaidTransactionId: { in: [...ids] },
      userId,
      ...(unchangedSince ? { updatedAt: { lt: unchangedSince } } : {}),
    },
  });
  return count;
}

export type RereadOutcome =
  | { kind: "done"; removed: number; carried: number }
  | { kind: "held"; posted: number; pending: number; rows: number };

export function postedCap(rows: number): number {
  return Math.max(REREAD_MAX_POSTED_REMOVALS, Math.floor(rows * REREAD_MAX_POSTED_SHARE));
}

const EDITED_PLACEMENT = new Set(["edited", "declined"]);

// `listedIds`: every Plaid transaction id the finished read from the start returned. `windows`:
// each account that read listed rows for (Jane's account id) with the earliest day listed for it. One transaction as the person.
export async function removeWhatPlaidDropped(
  userId: string,
  windows: ReadonlyMap<string, string>,
  listedIds: ReadonlySet<string>,
  // When the read began: a row saved or changed since (by a sync running beside this one, or by the
  // person) may be newer than the list, so it is never taken as dropped.
  startedAt: Date,
  client?: PrismaClient,
  // The link whose row is locked first, in the same transaction as the removals (after the sync's own
  // locked write transactions have committed): a replaced or replacing link refuses, so nothing is removed.
  itemId?: string,
): Promise<RereadOutcome> {
  return personTransaction(
    userId,
    async (tx): Promise<RereadOutcome> => {
      if (itemId) await lockLiveItem(tx, itemId);
      const all = await tx.transaction.findMany({
        where: {
          userId,
          accountId: { in: [...windows.keys()] },
          source: "plaid",
          plaidTransactionId: { not: null },
        },
        select: {
          id: true,
          plaidTransactionId: true,
          accountId: true,
          date: true,
          updatedAt: true,
          amountCents: true,
          pending: true,
          pfcPrimary: true,
          pfcDetailed: true,
          categorySource: true,
          incomePlacement: true,
          hsaReceipt: { select: { id: true } },
          _count: { select: { taxTags: true } },
        },
      });
      // Only rows dated on or after the earliest day the read lists for their own account are
      // candidates: older ones lie outside what an empty-cursor read covers, so they are not "one
      // Plaid dropped", and they do not count toward the cap either. An account the read lists
      // nothing for has no window, so none of its rows is touched.
      const held = all.filter(
        (r) => r.date.toISOString().slice(0, 10) >= windows.get(r.accountId)!,
      );
      const gone = held.filter(
        (r) => !listedIds.has(r.plaidTransactionId!) && r.updatedAt < startedAt,
      );
      const posted = gone.filter((r) => !r.pending);
      const pending = gone.length - posted.length;
      if (posted.length > postedCap(held.length)) {
        return { kind: "held", posted: posted.length, pending, rows: held.length };
      }
      const key = (r: { accountId: string; amountCents: number; date: Date }) =>
        `${r.accountId}|${r.amountCents}|${r.date.toISOString().slice(0, 10)}`;
      const counterparts = new Map<string, typeof held>();
      for (const r of held.filter((r) => listedIds.has(r.plaidTransactionId!))) {
        counterparts.set(key(r), [...(counterparts.get(key(r)) ?? []), r]);
      }
      const remove: string[] = [];
      let carried = 0;
      for (const r of gone) {
        const edited =
          r.categorySource === "user" ||
          (r.incomePlacement !== null && EDITED_PLACEMENT.has(r.incomePlacement)) ||
          r.hsaReceipt !== null ||
          r._count.taxTags > 0;
        const same = counterparts.get(key(r)) ?? [];
        // A hold the bank dropped is gone, whatever hangs on it. A posted row the person has
        // edited, with no row of the same account, amount and day to take its place, stays:
        // nothing is shown twice, and the edit is not lost to a guess.
        // Several rows to take its place (or several edited rows for one) is a guess too: it stays.
        const edits = gone.filter((g) => g.categorySource === "user" && key(g) === key(r)).length;
        if (
          !r.pending &&
          edited &&
          (same.length !== 1 || (r.categorySource === "user" && edits > 1))
        ) {
          continue;
        }
        // A reissued charge: exactly one new row of the same account, amount and day takes the
        // category the person set, as a posted charge takes it from its pending one.
        // Only when it is the one edited row for that new row: two edits to one row is a guess.
        if (
          r.categorySource === "user" &&
          edits === 1 &&
          same.length === 1 &&
          same[0].categorySource !== "user"
        ) {
          const { count } = await tx.transaction.updateMany({
            where: { id: same[0].id, userId, NOT: { categorySource: "user" } },
            data: {
              pfcPrimary: r.pfcPrimary,
              pfcDetailed: r.pfcDetailed,
              categorySource: "user",
            },
          });
          carried += count;
        }
        remove.push(r.plaidTransactionId!);
      }
      return {
        kind: "done",
        removed: await deleteRemoved(tx.transaction, userId, remove, startedAt),
        carried,
      };
    },
    client,
  );
}
