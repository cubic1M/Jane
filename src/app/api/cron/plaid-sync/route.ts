import { NextResponse } from "next/server";
import { CRON_SYNC_LIMIT, STALE_SYNC_HOURS } from "@/config/plaid";
import { db } from "@/lib/db";
import { plaidEnabled } from "@/lib/plaid/client";
import { ITEM_STATUS, syncItem } from "@/lib/plaid/sync";

// Vercel Cron, daily: syncs linked items that haven't synced in STALE_SYNC_HOURS, in case
// a webhook was missed. Vercel sends "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!plaidEnabled()) return NextResponse.json({ synced: 0, failed: 0 });

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
  return NextResponse.json({ synced, failed });
}
