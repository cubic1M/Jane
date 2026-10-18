import { SNAPSHOT_RETENTION_DAYS } from "@/config/net-worth";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";

// The daily balance snapshot, run by the daily job: today's balance for every account
// that has one. Safe to run more than once a day: each account gets one row per day.
export async function takeSnapshots({
  client = defaultClient,
  now = new Date(),
}: { client?: PrismaClient; now?: Date } = {}): Promise<{ saved: number; removed: number }> {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  // A system job across all users, writing each row with its own account's owner.
  const accounts = await client.account.findMany({
    where: { currentBalanceCents: { not: null }, user: { deletedAt: null } },
    select: { id: true, userId: true, currentBalanceCents: true },
  });
  let saved = 0;
  for (const a of accounts) {
    await client.balanceSnapshot.upsert({
      where: { accountId_date: { accountId: a.id, date: today } },
      create: {
        userId: a.userId,
        accountId: a.id,
        date: today,
        balanceCents: a.currentBalanceCents ?? 0,
      },
      update: { balanceCents: a.currentBalanceCents ?? 0 },
    });
    saved += 1;
  }
  const cutoff = new Date(today.getTime() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count: removed } = await client.balanceSnapshot.deleteMany({
    where: { date: { lt: cutoff } },
  });
  return { saved, removed };
}
