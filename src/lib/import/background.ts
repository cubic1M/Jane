import { matchCardPayments } from "@/categorize/card-payments";
import { categorizeLeftovers } from "@/categorize/categorize";
import { IMPORT_RUN_SHOWN_HOURS } from "@/config/import";
import { moneyFound, runDetection } from "@/detection/engine";
import type { PrismaClient } from "@/generated/prisma/client";
import { confirmSwitches } from "@/lib/agent/switch";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { remindDeadlines } from "@/lib/deadlines";
import { rebuildUploadedBalances } from "@/lib/import/balances";
import { insuranceAfterSync } from "@/lib/insurance/daily";
import { confirmInsuranceSwitches } from "@/lib/insurance/switch";
import { keepFullSnapshot, runJaneAgentSafely } from "@/lib/jane-agent/run";
import { enqueueJob, runJob } from "@/lib/jobs";
import { withReadCache } from "@/lib/read-cache";
import { markScanDone } from "@/lib/scan";
import { takeSnapshots } from "@/lib/snapshots";
import { scanSuggestions } from "@/lib/suggestions";

// An upload finished in the background (founder: "the import must not hold the page"). The tap
// saves the rows, sorted by the rules, and returns; this job does the rest while the person
// keeps using Jane, its stage shown by the progress chip on every page
// (src/components/import-chip.tsx):
//   matching   card payments paired with what paid them
//   balances   the uploaded accounts' balances over time (net worth's line)
//   looking    detection: the findings and the "found $X/yr" total
//   refreshing everything else per person that a bank sync refreshes, and the daily runs refresh
//              for everyone: suggestions in every area, deadlines, switches and insurance that
//              the new rows confirm, today's balance snapshot, and the first scan marked done
//   done       with the money found
// Then, after "done", Claude sorts the merchants no rule knew (one call per 50, at once), and
// if that moved anything the card payments, findings and numbers are worked out again; Jane's
// saved numbers and snapshot for the chat are kept (seconds, and no page reads them); the card
// text is written and Jane says what's new in the chat.

export type ImportStage =
  "queued" | "matching" | "balances" | "looking" | "refreshing" | "done" | "failed";

type Options = { client?: PrismaClient; now?: Date };

// The share of the chip's bar each stage starts at.
export const STAGE_PERCENT: Record<ImportStage, number> = {
  queued: 5,
  matching: 15,
  balances: 25,
  looking: 40,
  refreshing: 75,
  done: 100,
  failed: 100,
};

// Everything per person that new transactions change, each on its own so one failing never
// stops the rest (as after a bank sync, src/lib/plaid/sync.ts).
export async function refreshAfterUpload(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const results = await Promise.allSettled([
    scanSuggestions(userId, { client, now }),
    confirmSwitches({ client, now, userId }),
    confirmInsuranceSwitches({ client, now, userId }),
    insuranceAfterSync(userId, { client, now }),
    remindDeadlines(userId, { client, now }),
    takeSnapshots({ client, now, userIds: [userId] }),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Refreshing a sector after an upload failed", { error: String(result.reason) });
    }
  }
  await markScanDone(userId, { client, now }).catch((error) =>
    console.error("Marking the scan done after an upload failed", { error: String(error) }),
  );
}

// The chat's saved numbers and snapshot, from everything above. No page reads them (Jane does,
// when asked), and they take seconds, so they're kept after "done".
async function refreshChatNumbers(
  userId: string,
  { client = defaultClient, now = new Date() }: Options,
) {
  await keepFullSnapshot(userId, { client, now }).catch((error) =>
    console.error("Keeping the snapshot after an upload failed", { error: String(error) }),
  );
  await import("@/lib/jane-agent/claude-tools")
    .then((m) => m.refreshPrimer(userId, { client, now }))
    .catch((error) =>
      console.error("Saving the numbers for Claude after an upload failed", {
        error: String(error),
      }),
    );
}

// Card payments, balances, findings and every number, from what's stored now.
async function workOut(userId: string, options: Options, stage: (s: ImportStage) => Promise<void>) {
  const db = scopedFor(userId, options.client);
  await stage("matching");
  await matchCardPayments(db);
  await stage("balances");
  await rebuildUploadedBalances(db, options.now);
  await stage("looking");
  await runDetection(userId, options);
  await stage("refreshing");
  await refreshAfterUpload(userId, options);
}

// The import_finish job. Its parts read the same person's facts again and again (the detectors,
// the suggestions, Jane's numbers), so it runs with a read cache, as a bank sync does
// (src/lib/read-cache.ts).
export async function finishImport(
  userId: string,
  runId: string,
  options: Options = {},
): Promise<void> {
  return withReadCache(options.client ?? defaultClient, (client) =>
    finishImportWork(userId, runId, { ...options, client }),
  );
}

async function finishImportWork(userId: string, runId: string, options: Options): Promise<void> {
  const db = scopedFor(userId, options.client);
  const stage = async (s: ImportStage, foundCents?: number) => {
    await db.importRuns.updateMany({
      where: { id: runId },
      data: { stage: s, ...(foundCents === undefined ? {} : { foundCents }) },
    });
  };
  try {
    await workOut(userId, options, stage);
    await stage("done", await moneyFound(userId, options));
  } catch (error) {
    await stage("failed").catch(() => {});
    throw error;
  }

  // After "done": Claude for what the rules didn't know, Jane's saved numbers, then the card text
  // and the chat.
  try {
    if ((await categorizeLeftovers(db)) > 0) {
      await workOut(userId, options, async () => {});
      await stage("done", await moneyFound(userId, options));
    }
  } catch (error) {
    console.error("Sorting the rest of an upload failed", { error: String(error) });
  }
  await refreshChatNumbers(userId, options);
  await runJob(await enqueueJob("explain_findings", { userId }, options), options);
  await runJaneAgentSafely(userId, { ...options, trigger: "import" });
}

export type ImportRunView = {
  id: string;
  // "upload", or "removal": the numbers worked out again after something was removed.
  kind: string;
  rows: number;
  stage: ImportStage;
  percent: number;
  foundCents: number | null;
};

// The upload the chip shows: the latest in the last IMPORT_RUN_SHOWN_HOURS, unless the person
// closed it. Never an older one: closing the newest chip brought back the first file's ("Done:
// found $214/yr" after a second file had made it $669, night QA 10-30). Null when there's none.
export async function currentImportRun(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ImportRunView | null> {
  const run = await scopedFor(userId, client).importRuns.findFirst({
    where: {
      createdAt: { gte: new Date(now.getTime() - IMPORT_RUN_SHOWN_HOURS * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, rows: true, stage: true, foundCents: true, seenAt: true },
  });
  if (!run || run.seenAt) return null;
  const stage = (run.stage in STAGE_PERCENT ? run.stage : "queued") as ImportStage;
  const { seenAt: _seen, ...shown } = run;
  return { ...shown, stage, percent: STAGE_PERCENT[stage] };
}

// The person closed the chip.
export async function dismissImportRun(
  userId: string,
  runId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).importRuns.updateMany({
    where: { id: runId },
    data: { seenAt: now },
  });
}
