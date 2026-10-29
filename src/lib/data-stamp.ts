import type { PrismaClient } from "@/generated/prisma/client";

// Which accounts and transactions the person has right now, in two small queries: how many, and
// when the newest was added. Rows added or removed change it (a bank linked or disconnected, a
// file uploaded or removed, new transactions); edits don't (a category, a balance refresh), so a
// saved copy isn't thrown away for those, which the next sync or correction refreshes anyway. Anything worked out from the data and saved for
// later (the chat's numbers, Jane's snapshot) keeps the stamp it was built from, and isn't used
// once the stamp differs. Without it the
// chat answered with a disconnected demo bank's $1,349 purchase and balance (card-chat mismatch).

export async function dataStamp(userId: string, client: PrismaClient): Promise<string | null> {
  try {
    // Loaded here: the stores that compare stamps are read by modules that never touch the
    // database (and their tests).
    const { scopedFor } = await import("@/lib/db-scoped");
    const db = scopedFor(userId, client);
    const [accounts, transactions] = await Promise.all([
      db.accounts.aggregate({ _count: { _all: true }, _max: { createdAt: true } }),
      db.transactions.aggregate({ _count: { _all: true }, _max: { createdAt: true } }),
    ]);
    return [
      accounts._count._all,
      accounts._max.createdAt?.getTime() ?? 0,
      transactions._count._all,
      transactions._max.createdAt?.getTime() ?? 0,
    ].join(":");
  } catch {
    // No database to read (a test's stand-in): nothing to compare against.
    return null;
  }
}

// A saved copy is current when it was built from the data as it is now. One with no stamp, or
// read when the stamp can't be worked out, counts as current only when neither has one.
export const sameData = (saved: string | null | undefined, now: string | null) =>
  (saved ?? null) === now;
