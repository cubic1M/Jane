import type { PlaidSync } from "@/data-sources/plaid/plaid-source";
import type { PrismaClient } from "@/generated/prisma/client";
import { log } from "@/lib/log";
import { recordOpsEvent } from "@/lib/ops-alerts";
import { removeWhatPlaidDropped } from "@/lib/plaid/reread-removals";

export type RereadResult = {
  removed: number;
  // The saved cursor stays (the removals were held back, or could not be made).
  keepCursor: boolean;
  // false: the re-read did not count and a later sync tries again.
  spent: boolean;
  // Counts only, for /admin/history: "9 posted of 140 rows".
  held: string | null;
};

// After a read from the start has been saved: drop what Plaid no longer lists, or hold back (see
// reread-removals.ts). Never throws: a failure keeps the cursor, so the next sync starts from it.
export async function finishRead(
  userId: string,
  accountIds: ReadonlyMap<string, string>,
  sync: PlaidSync,
  client: PrismaClient,
  startedAt: Date,
): Promise<RereadResult> {
  const retry = { removed: 0, keepCursor: true, spent: false, held: null } as const;
  // Plaid has nothing ready yet: not a set to compare against, so nothing is removed and the link
  // is read from the start again later.
  // Plaid has only the first 30 days so far (historyPending): the list is not the whole set either.
  if (sync.notReady || sync.historyPending) return retry;
  // A finished read that lists nothing is not trusted to say every row Jane holds is gone either:
  // nothing is removed (the ordinary sync's removals, if any, still come).
  if (sync.transactions.length === 0) {
    return { removed: 0, keepCursor: false, spent: true, held: null };
  }
  try {
    const listed = new Set(sync.transactions.map((t) => t.externalId));
    const windows = new Map<string, string>();
    for (const t of sync.transactions) {
      const id = accountIds.get(t.accountRef);
      if (id && (!windows.has(id) || t.date < windows.get(id)!)) windows.set(id, t.date);
    }
    const out = await removeWhatPlaidDropped(userId, windows, listed, startedAt, client);
    if (out.kind === "done")
      return { removed: out.removed, keepCursor: false, spent: true, held: null };
    log.warn("A bank's read from the start would remove too many rows; nothing removed", {
      posted: out.posted,
      pending: out.pending,
      rows: out.rows,
    });
    await recordOpsEvent("plaid_reread_held", { userId, client });
    return {
      removed: 0,
      keepCursor: true,
      spent: true,
      held: `${out.posted} posted of ${out.rows} rows`,
    };
  } catch (error) {
    log.error("Removing what a bank dropped failed; going on from the saved cursor", {
      error: String(error),
    });
    return retry;
  }
}
