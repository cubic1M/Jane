import { SNAPSHOT_RETENTION_DAYS } from "@/config/net-worth";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { ownedBy, ownedByStaying, type OnlyPeople } from "@/lib/only-people";
import { scopedFor } from "@/lib/db-scoped";
import { systemDb } from "@/lib/system-db";
import { localDate } from "@/lib/today";

// The daily balance snapshot, run by the daily job: today's balance for every account
// that has one. Safe to run more than once a day: each account gets one row per day.
// "Today" is the owner's day (gate C): on UTC's, an upload saved at 9pm in Los Angeles left a
// snapshot dated tomorrow (debug 3, 11-17).
export async function takeSnapshots({
  client = defaultClient,
  now = new Date(),
  userIds,
}: { client?: PrismaClient; now?: Date } & OnlyPeople = {}): Promise<{
  saved: number;
  skipped: number;
  removed: number;
}> {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  // A system job across all users, writing each row with its own account's owner.
  const accounts = await systemDb(
    "Cron: finds who to run for, across people",
    client,
  ).account.findMany({
    where: {
      currentBalanceCents: { not: null },
      user: { deletedAt: null },
      ...ownedByStaying(userIds),
    },
    select: {
      id: true,
      userId: true,
      currentBalanceCents: true,
      user: { select: { timezone: true } },
    },
  });
  let saved = 0;
  let skipped = 0;
  for (const a of accounts) {
    try {
      const day = new Date(`${localDate(now, a.user.timezone)}T00:00:00Z`);
      await scopedFor(a.userId, client).balanceSnapshots.upsert({
        where: { accountId_date: { accountId: a.id, date: day } },
        create: {
          userId: a.userId,
          accountId: a.id,
          date: day,
          balanceCents: a.currentBalanceCents ?? 0,
        },
        update: { balanceCents: a.currentBalanceCents ?? 0 },
      });
      saved += 1;
    } catch (error) {
      // The account (or its owner) was deleted after it was read: nothing to snapshot.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }
  const cutoff = new Date(today.getTime() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count: removed } = await systemDb(
    "Cron: finds who to run for, across people",
    client,
  ).balanceSnapshot.deleteMany({
    where: { date: { lt: cutoff }, ...ownedBy(userIds) },
  });
  return { saved, skipped, removed };
}
