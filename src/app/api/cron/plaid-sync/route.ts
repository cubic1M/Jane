import { NextResponse } from "next/server";
import { CRON_SYNC_LIMIT, STALE_SYNC_HOURS } from "@/config/plaid";
import { db } from "@/lib/db";
import { plaidEnabled } from "@/lib/plaid/client";
import { runInactiveCleanup } from "@/lib/plaid/inactive";
import { ITEM_STATUS, syncItem } from "@/lib/plaid/sync";
import { runDueJobs } from "@/lib/jobs";
import { refreshMerchantOutcomes } from "@/lib/merchant-outcomes";
import { takeSnapshots } from "@/lib/snapshots";

// Vercel Cron, daily: syncs linked items that haven't synced in STALE_SYNC_HOURS, in case
// a webhook was missed, then removes items of people inactive for INACTIVE_ITEM_DAYS
// (after a warning email), then snapshots every account's balance for net worth over
// time (CSV accounts too, so that runs even without Plaid). Vercel sends
// "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!plaidEnabled()) {
    return NextResponse.json({
      synced: 0,
      failed: 0,
      inactive: null,
      snapshots: await takeSnapshots(),
      jobs: await runDueJobs(),
      outcomes: await refreshMerchantOutcomes(),
    });
  }

  const cutoff = new Date(Date.now() - STALE_SYNC_HOURS * 60 * 60 * 1000);
  // A system job across all users: it reads item ids only, and syncItem scopes each one.
  const items = await db.plaidItem.findMany({
    where: {
      status: ITEM_STATUS.active,
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }],
    },
    select: { id: true },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: CRON_SYNC_LIMIT,
  });

  let synced = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await syncItem(item.id);
      synced += 1;
    } catch (error) {
      failed += 1;
      console.error("Scheduled Plaid sync failed", { itemId: item.id, error: String(error) });
    }
  }
  const inactive = await runInactiveCleanup();
  return NextResponse.json({
    synced,
    failed,
    inactive,
    snapshots: await takeSnapshots(),
    jobs: await runDueJobs(),
    outcomes: await refreshMerchantOutcomes(),
  });
}
