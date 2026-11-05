import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { CRON_SYNC_BUDGET_MS, CRON_SYNC_LIMIT, STALE_SYNC_HOURS } from "@/config/plaid";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { freshSwitches } from "@/lib/ops-switches";
import { plaidEnabled } from "@/lib/plaid/client";
import { runInactiveCleanup } from "@/lib/plaid/inactive";
import { ITEM_STATUS, syncItem } from "@/lib/plaid/sync";
import { ROBINHOOD_LIMITS } from "@/config/robinhood";
import { refreshAllRobinhood } from "@/lib/robinhood/refresh";
import { alertError } from "@/lib/error-alerts";
import { recordRun, reportMissedJobs } from "@/lib/health";
import { deleteTrialsPastTheirTime } from "@/lib/trial-delete";
import { runAgentFollowUps } from "@/lib/agent/run";
import { runDueJobs } from "@/lib/jobs";
import { queueNightlyRuns } from "@/lib/controller";
import { CONTROLLER_CRON_BUDGET_MS, CONTROLLER_RUN_RESERVE_MS } from "@/config/controller";
import { CRON_JOBS_BUDGET_MS } from "@/config/jobs";
import { refreshMerchantOutcomes } from "@/lib/merchant-outcomes";
import { runRetention } from "@/lib/retention";
import { refreshKindStats } from "@/lib/learning";
import { takeSnapshots } from "@/lib/snapshots";
import { remindAllDeadlines } from "@/lib/deadlines";
import { insuranceDaily } from "@/lib/insurance/daily";
import { runAutoInvestForAll } from "@/lib/investments/auto-invest";
import { refreshDemoPrices } from "@/lib/investments/prices";
import { collectAllReceipts } from "@/lib/investments/hsa";
import { syncAllCrypto } from "@/lib/crypto/crypto";
import { settleAllLadders } from "@/lib/investments/short-term";
import { settleAllRollovers } from "@/lib/investments/old-accounts";
import { runAutomaticInvestingForAll } from "@/lib/investments/automatic";
import { forgetRemovedDemoBanks } from "@/lib/evidence/backfill";
import { removeAllOrphans } from "@/lib/evidence/orphans";
import { refreshAfterRemoval } from "@/lib/import/background";
import { STAYING } from "@/lib/only-people";
import { systemDb } from "@/lib/system-db";

const ROUTE = "/api/cron/plaid-sync";

// Vercel Cron, daily: syncs linked items that haven't synced in STALE_SYNC_HOURS, in case
// a webhook was missed, then removes items of people inactive for INACTIVE_ITEM_DAYS
// (after a warning email), then snapshots every account's balance for net worth over
// time (CSV accounts too, so that runs even without Plaid), and last raises deadline
// reminders (spec step 71) from what just synced. Vercel sends
// "Authorization: Bearer $CRON_SECRET".
// The function's limit, declared like the other long crons. The controller runs last and gets
// only what's left of it (debugger 10-31: it drained for up to 240 s mid-list, the request hit
// the limit with a 504, and the health check called this job and the digest stale).
export const maxDuration = 300;

export async function GET(request: Request) {
  const startedAt = Date.now();
  if (!cronAuthorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await deleteTemporaryTries();
  await checkHealth();
  return NextResponse.json(await recordRun("plaid-sync", () => dailyWork(startedAt)));
}

// First, on its own: the legal pages promise this, so nothing else tonight may stop it, by throwing
// or by using up the time. If it fails, the team hears now, and the rest of the night still runs.
async function deleteTemporaryTries() {
  try {
    await recordRun("trial-cleanup", () => deleteTrialsPastTheirTime());
  } catch (error) {
    const kind = error instanceof Error ? error.name : "Error";
    log.error("Deleting temporary tries failed", { error: kind });
    await alertError(
      { message: `${kind}: trial clean-up failed`, path: ROUTE },
      { pastCeiling: true },
    );
  }
}

// Tells the team if another daily job has stopped. Never stops this one.
async function checkHealth() {
  try {
    await reportMissedJobs();
  } catch (error) {
    log.error("Health check failed", { error: String(error) });
  }
}

// The nightly controller, with the time left before the limit (none left: it only queues, and
// the job runner takes the runs up next).
// The due jobs: their usual minute, or what's left of the limit, less one controller run.
const jobsBudget = (startedAt: number) =>
  Math.max(
    0,
    Math.min(
      CRON_JOBS_BUDGET_MS,
      maxDuration * 1000 - CONTROLLER_RUN_RESERVE_MS - (Date.now() - startedAt),
    ),
  );

// Robinhood's reads, if there's time for one more person's and the rest of the night: it runs early,
// and a slow Robinhood mustn't use up what retention and the deadlines need.
const robinhoodBudget = (startedAt: number) =>
  Math.max(
    0,
    Math.min(
      ROBINHOOD_LIMITS.cronBudgetMs,
      maxDuration * 1000 -
        CONTROLLER_RUN_RESERVE_MS -
        ROBINHOOD_LIMITS.personBudgetMs -
        (Date.now() - startedAt),
    ),
  );

const controller = (startedAt: number) =>
  queueNightlyRuns({
    budgetMs: Math.max(
      0,
      Math.min(
        CONTROLLER_CRON_BUDGET_MS,
        maxDuration * 1000 - CONTROLLER_RUN_RESERVE_MS - (Date.now() - startedAt),
      ),
    ),
  });

// One step of the night. If it fails, the team hears now and the steps after it still run: one
// person's odd row mustn't cost everyone their deadlines, or the deleting the legal pages promise.
// The run still ends as failed, so the health check counts it. Only the step and the error's class
// are logged: a database error's message can carry someone's values.
const stepRunner = (failed: string[]) =>
  async function step<T>(name: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      const kind = error instanceof Error ? error.name : "Error";
      failed.push(name);
      log.error("A nightly step failed", { step: name, error: kind });
      await alertError(
        { message: `${kind}: nightly step failed`, path: `${ROUTE}/${name}` },
        { pastCeiling: true },
      );
      return null;
    }
  };

// Linked banks not synced lately. A system job across all users: it reads item ids only, and
// syncItem scopes each one.
async function syncBanks() {
  const cutoff = new Date(Date.now() - STALE_SYNC_HOURS * 60 * 60 * 1000);
  const items = await systemDb("Cron: finds every bank connection due a sync").plaidItem.findMany({
    where: {
      status: ITEM_STATUS.active,
      userId: STAYING,
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }],
    },
    select: { id: true },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: CRON_SYNC_LIMIT,
  });

  let synced = 0;
  let failed = 0;
  let deferred = 0;
  // Its own clock: deleting temporary tries comes first, and isn't the banks' time to lose.
  const syncStarted = Date.now();
  for (const item of items) {
    if (Date.now() - syncStarted >= CRON_SYNC_BUDGET_MS) {
      deferred += 1;
      continue;
    }
    try {
      await syncItem(item.id);
      synced += 1;
    } catch (error) {
      failed += 1;
      log.error("Scheduled Plaid sync failed", { itemId: item.id, error: String(error) });
    }
  }
  return { synced, failed, deferred };
}

// Banks of people gone quiet. We tell them we disconnect these, so a removal that failed is the
// team's to hear about, though the person's own failure doesn't stop the others.
async function inactiveCleanup() {
  const inactive = await runInactiveCleanup();
  if (inactive.failed > 0) {
    await alertError(
      { message: "InactiveCleanupFailed: a bank wasn't disconnected", path: `${ROUTE}/inactive` },
      { pastCeiling: true },
    );
  }
  return inactive;
}

async function dailyWork(startedAt: number) {
  const failedSteps: string[] = [];
  const step = stepRunner(failedSteps);
  await step("switches", freshSwitches);
  // Early, like the temporary tries: the privacy page promises it, and it needs little time.
  const retention = await step("retention", () => runRetention({ skipTrials: true }));
  const banks = plaidEnabled()
    ? await step("banks", syncBanks)
    : { synced: 0, failed: 0, deferred: 0 };
  const inactive = plaidEnabled() ? await step("inactive", inactiveCleanup) : null;
  const night = {
    ...(banks ?? { synced: 0, failed: 0, deferred: 0 }),
    inactive,
    robinhood: await step("robinhood", () =>
      refreshAllRobinhood({ budgetMs: robinhoodBudget(startedAt) }),
    ),
    snapshots: await step("snapshots", () => takeSnapshots()),
    jobs: await step("jobs", () => runDueJobs({ budgetMs: jobsBudget(startedAt) })),
    agent: await step("agent", () => runAgentFollowUps()),
    outcomes: await step("outcomes", () => refreshMerchantOutcomes()),
    retention,
    // Derived rows whose evidence is gone (card-chat mismatch): also the one-off cleanup.
    orphans: await step("orphans", () => removeAllOrphans()),
    // Demo banks removed before their derived rows went with them: once each.
    demoCleanup: await step("demoCleanup", () =>
      forgetRemovedDemoBanks({ refresh: (id) => refreshAfterRemoval(id) }),
    ),
    // The learning loop: what everyone did with each kind of suggestion, for tomorrow's ranking.
    learning: await step("learning", () => refreshKindStats()),
    deadlines: await step("deadlines", () => remindAllDeadlines()),
    // Spec steps 104 and 106: insurance reshopped and checked by itself.
    insurance: await step("insurance", () => insuranceDaily()),
    // Spec step 134: automatic investing on new paychecks.
    autoInvest: await step("autoInvest", () => runAutoInvestForAll()),
    // Spec step 156: demo holdings revalued at the stand-in feed's prices.
    prices: await step("prices", () => refreshDemoPrices()),
    // Spec step 159: medical charges saved to the HSA receipts vault.
    hsaReceipts: await step("hsaReceipts", () => collectAllReceipts()),
    // Spec step 161: crypto balances read again (read-only).
    crypto: await step("crypto", () => syncAllCrypto()),
    // Spec step 164: fully automatic investing, within the person's caps.
    automaticInvesting: await step("automaticInvesting", () => runAutomaticInvestingForAll()),
    // Spec step 211: rollovers whose money has arrived.
    rollovers: await step("rollovers", () => settleAllRollovers()),
    // Spec step 234: Treasury bills that matured are rolled into the next (stand-in).
    ladders: await step("ladders", () => settleAllLadders()),
    // Spec step 142: each person's nightly controller run, through the jobs table. Last.
    controller: await step("controller", () => controller(startedAt)),
  };
  if (failedSteps.length > 0) throw new Error(`Nightly steps failed: ${failedSteps.join(", ")}`);
  return night;
}
