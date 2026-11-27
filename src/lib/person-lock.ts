import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { systemTransaction } from "@/lib/system-db";

// One person's work done by one runner at a time, with no column to keep: a Postgres advisory lock
// held by a transaction that stays open while `run` works, and released when it ends (a crash
// included, so no claim is ever left behind). `name` keeps different kinds of work apart.
//
// `wait: false` (the default) returns { ran: false } at once when another runner holds it, so a
// scan that is already going is not started twice. `wait: true` queues behind the holder: for a
// short read-then-write that must not interleave (a daily quota).
export type PersonLocked<T> = { ran: true; value: T } | { ran: false };

const LOCK_TRANSACTION = { maxWait: 60_000, timeout: 600_000 };

export async function withPersonLock<T>(
  name: string,
  userId: string,
  run: () => Promise<T>,
  { client = defaultClient, wait = false }: { client?: PrismaClient; wait?: boolean } = {},
): Promise<PersonLocked<T>> {
  const key = `${name}:${userId}`;
  return systemTransaction(
    "A lock per person: the same work for one person never runs twice at once",
    async (tx) => {
      if (wait) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      } else {
        const [row] = await tx.$queryRaw<{ got: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS got`;
        if (!row?.got) return { ran: false } as const;
      }
      return { ran: true, value: await run() } as const;
    },
    client,
    LOCK_TRANSACTION,
  );
}
