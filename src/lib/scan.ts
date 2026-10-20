import { SCAN_MAX_MINUTES } from "@/config/scan";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The first scan after a bank is linked: still going until detection, the sectors' work and
// Jane's first run have finished (first_scan_done_at), for at most SCAN_MAX_MINUTES from
// when the bank was linked.

type Options = { client?: PrismaClient; now?: Date };

export async function scanInProgress(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { firstScanDoneAt: true },
  });
  if (!user || user.firstScanDoneAt) return false;
  const since = new Date(now.getTime() - SCAN_MAX_MINUTES * 60_000);
  return (
    (await scopedFor(userId, client).plaidItems.count({ where: { createdAt: { gt: since } } })) > 0
  );
}

export async function markScanDone(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  await client.user.updateMany({
    where: { id: userId, firstScanDoneAt: null },
    data: { firstScanDoneAt: now },
  });
}

// Accounts and transactions are in: enough for the chat to open.
export async function scanReady(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const [accounts, transactions] = await Promise.all([
    db.accounts.count(),
    db.transactions.count(),
  ]);
  return accounts > 0 && transactions > 0;
}
