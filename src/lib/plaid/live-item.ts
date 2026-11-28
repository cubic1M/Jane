import { HIDDEN_ITEM_STATUSES } from "@/config/plaid";
import { Prisma } from "@/generated/prisma/client";
import type { PersonTx } from "@/lib/db-scoped";

// Takes a shared lock on the link's row and refuses when the link is not a live one. The move of a
// link's accounts (src/lib/plaid/replace.ts) claims the same row first thing, so a sync's rows and the
// move exclude each other: a sync that writes holds the move off until it has committed (the move then
// sees its rows and refuses), and a sync that comes after the move finds the link replaced and writes
// nothing. Every write of a sync's rows runs inside a transaction that begins with this: the accounts,
// the transactions, and the removals after a read from the start (reread-removals.ts).
export async function lockLiveItem(tx: PersonTx, itemId: string) {
  const live = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM plaid_items
    WHERE id = ${itemId} AND status NOT IN (${Prisma.join([...HIDDEN_ITEM_STATUSES])})
    FOR SHARE`;
  if (live.length === 0) throw new Error("Plaid item was replaced");
}
