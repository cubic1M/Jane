import { NextResponse } from "next/server";
import { CRON_SYNC_LIMIT, STALE_SYNC_HOURS } from "@/config/plaid";
import { db } from "@/lib/db";
import { plaidEnabled } from "@/lib/plaid/client";
import { runInactiveCleanup } from "@/lib/plaid/inactive";
import { ITEM_STATUS, syncItem } from "@/lib/plaid/sync";
import { recordRun, reportMissedJobs } from "@/lib/health";
import { runAgentFollowUps } from "@/lib/agent/run";
import { runDueJobs } from "@/lib/jobs";
import { queueNightlyRuns } from "@/lib/controller";
import { refreshMerchantOutcomes } from "@/lib/merchant-outcomes";
import { runRetention } from "@/lib/retention";
import { takeSnapshots } from "@/lib/snapshots";
import { remindAllDeadlines } from "@/lib/deadlines";
import { insuranceDaily } from "@/lib/insurance/daily";
import { runAutoInvestForAll } from "@/lib/investments/auto-invest";
import { refreshDemoPrices } from "@/lib/investments/prices";

// Vercel Cron, daily: syncs linked items that haven't synced in STALE_SYNC_HOURS, in case
// a webhook was missed, then removes items of people inactive for INACTIVE_ITEM_DAYS
// (after a warning email), then snapshots every account's balance for net worth over
// time (CSV accounts too, so that runs even without Plaid), and last raises deadline
// reminders (spec step 71) from what just synced. Vercel sends
// "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await checkHealth();
  return NextResponse.json(await recordRun("plaid-sync", dailyWork));
}

// Tells the team if another daily job has stopped. Never stops this one.
async function checkHealth() {
  try {
    await reportMissedJobs();
  } catch (error) {
    console.error("Health check failed", { error: String(error) });
  }
}

async function dailyWork() {
  if (!plaidEnabled()) {
    return {
      synced: 0,
      failed: 0,
      inactive: null,
      snapshots: await takeSnapshots(),
      jobs: await runDueJobs(),
      agent: await runAgentFollowUps(),
      outcomes: await refreshMerchantOutcomes(),
      retention: await runRetention(),
      deadlines: await remindAllDeadlines(),
      // Spec steps 104 and 106: insurance reshopped and checked by itself.
      insurance: await insuranceDaily(),
      // Spec step 134: automatic investing on new paychecks.
      autoInvest: await runAutoInvestForAll(),
      // Spec step 142: each person's nightly controller run, through the jobs table.
      controller: await queueNightlyRuns(),
      // Spec step 156: demo holdings revalued at the stand-in feed's prices.
      prices: await refreshDemoPrices(),
    };
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
  return {
    synced,
    failed,
    inactive,
    snapshots: await takeSnapshots(),
    jobs: await runDueJobs(),
    agent: await runAgentFollowUps(),
    outcomes: await refreshMerchantOutcomes(),
    retention: await runRetention(),
    deadlines: await remindAllDeadlines(),
    insurance: await insuranceDaily(),
    autoInvest: await runAutoInvestForAll(),
    // Spec step 142: each person's nightly controller run, through the jobs table.
    controller: await queueNightlyRuns(),
    prices: await refreshDemoPrices(),
  };
}
