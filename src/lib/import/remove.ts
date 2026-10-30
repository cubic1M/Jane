import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import type { ScopedDb } from "@/lib/db-scoped";
import { FILE_SOURCE } from "@/lib/import/balances";
import { forgetSince } from "@/lib/evidence/orphans";
import { enqueueJob } from "@/lib/jobs";

// Taking uploads back (founder: old and new statements shouldn't mix): one upload's rows, an
// uploaded account with everything in it, or every uploaded account at once ("Start over").
// Linked banks and settings are never touched. Every query is the signed-in person's own
// (scopedFor). After each, the same background job as an upload works the numbers out again
// (src/lib/import/background.ts), so findings, the "found $X/yr" total and the money pages drop
// what came from the removed rows. A finding built only from removed rows goes too, with the
// person's answer and any action on it (src/lib/evidence/orphans.ts, run by that job's detection):
// nothing may stand on evidence that is gone. Each removal is audit-logged and counted, counts only.

export type UploadView = {
  id: string;
  accountId: string;
  accountName: string;
  fileNames: string[];
  from: string | null;
  to: string | null;
  rows: number;
  at: Date;
};

// Rows uploaded before uploads were recorded, per account: removed with "Remove these".
export type EarlierRows = {
  accountId: string;
  accountName: string;
  rows: number;
  from: string;
  to: string;
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function listUploads(
  db: Pick<ScopedDb, "importRuns" | "accounts" | "transactions">,
): Promise<{ uploads: UploadView[]; earlier: EarlierRows[] }> {
  const [runs, accounts, earlier] = await Promise.all([
    db.importRuns.findMany({
      where: { kind: "upload", accountId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        accountId: true,
        fileNames: true,
        fromDate: true,
        toDate: true,
        rows: true,
        createdAt: true,
      },
    }),
    db.accounts.findMany({ where: { source: "csv" }, select: { id: true, name: true } }),
    db.transactions.groupBy({
      by: ["accountId"],
      where: { source: "csv", importRunId: null },
      _count: true,
      _min: { date: true },
      _max: { date: true },
    }),
  ]);
  const name = new Map(accounts.map((a) => [a.id, a.name]));
  return {
    uploads: runs.flatMap((r) =>
      r.accountId && name.has(r.accountId)
        ? [
            {
              id: r.id,
              accountId: r.accountId,
              accountName: name.get(r.accountId)!,
              fileNames: r.fileNames,
              from: iso(r.fromDate),
              to: iso(r.toDate),
              rows: r.rows,
              at: r.createdAt,
            },
          ]
        : [],
    ),
    earlier: earlier.flatMap((e) =>
      name.has(e.accountId) && e._min.date && e._max.date
        ? [
            {
              accountId: e.accountId,
              accountName: name.get(e.accountId)!,
              rows: e._count,
              from: iso(e._min.date)!,
              to: iso(e._max.date)!,
            },
          ]
        : [],
    ),
  };
}

// What "Start over" would remove, for its confirm.
export async function uploadedTotals(
  db: Pick<ScopedDb, "accounts" | "transactions">,
): Promise<{ accounts: number; rows: number }> {
  const [accounts, rows] = await Promise.all([
    db.accounts.count({ where: { source: "csv" } }),
    db.transactions.count({ where: { source: "csv" } }),
  ]);
  return { accounts, rows };
}

export type Removed = { rows: number; accounts: number; jobId: string } | null;

// The numbers worked out again in the background, shown by the chip as an update.
// What was worked out since the removed rows arrived is forgotten (src/lib/evidence/orphans.ts
// forgetSince), then the background job works everything out again from what is left.
async function refreshAfterRemoval(db: RemoveDb, since: Date): Promise<string> {
  await forgetSince(db, since, "upload");
  const run = await db.importRuns.create({
    data: { userId: db.userId, kind: "removal", rows: 0 },
    select: { id: true },
  });
  return enqueueJob("import_finish", { userId: db.userId, importRunId: run.id });
}

async function record(
  userId: string,
  event: "upload_removed" | "uploaded_account_removed" | "uploads_reset",
  counts: { rows: number; accounts: number },
) {
  await Promise.all([
    logAudit({ type: "user", id: userId }, event, null, counts),
    track(userId, event, counts),
  ]);
}

type RemoveDb = ScopedDb;

// Exactly the rows one upload added (rows it found already there stay with the upload that
// added them), and the statement balances kept for the days it covered.
export async function removeUpload(db: RemoveDb, runId: string): Promise<Removed> {
  const run = await db.importRuns.findFirst({
    where: { id: runId, kind: "upload" },
    select: { id: true, accountId: true, fromDate: true, toDate: true, createdAt: true },
  });
  if (!run) return null;
  const { count } = await db.transactions.deleteMany({ where: { importRunId: run.id } });
  if (run.accountId && run.fromDate && run.toDate) {
    await db.balanceSnapshots.deleteMany({
      where: {
        accountId: run.accountId,
        source: FILE_SOURCE,
        date: { gte: run.fromDate, lte: run.toDate },
      },
    });
  }
  await db.importRuns.deleteMany({ where: { id: run.id } });
  await record(db.userId, "upload_removed", { rows: count, accounts: 0 });
  return { rows: count, accounts: 0, jobId: await refreshAfterRemoval(db, run.createdAt) };
}

// The rows an uploaded account got before uploads were recorded.
export async function removeEarlierRows(db: RemoveDb, accountId: string): Promise<Removed> {
  const account = await db.accounts.findFirst({
    where: { id: accountId, source: "csv" },
    select: { id: true, createdAt: true },
  });
  if (!account) return null;
  const { count } = await db.transactions.deleteMany({
    where: { accountId: account.id, source: "csv", importRunId: null },
  });
  await record(db.userId, "upload_removed", { rows: count, accounts: 0 });
  return { rows: count, accounts: 0, jobId: await refreshAfterRemoval(db, account.createdAt) };
}

// An uploaded account and everything in it (its rows, balances and uploads go with it).
// Never a linked bank's account: those are disconnected from Settings.
export async function removeUploadedAccount(db: RemoveDb, accountId: string): Promise<Removed> {
  const account = await db.accounts.findFirst({
    where: { id: accountId, source: "csv" },
    select: { id: true, createdAt: true },
  });
  if (!account) return null;
  const rows = await db.transactions.count({ where: { accountId: account.id } });
  await db.accounts.deleteMany({ where: { id: account.id, source: "csv" } });
  await record(db.userId, "uploaded_account_removed", { rows, accounts: 1 });
  return { rows, accounts: 1, jobId: await refreshAfterRemoval(db, account.createdAt) };
}

// Every uploaded account and statement, in one step. Linked banks and settings stay.
export async function startOver(db: RemoveDb): Promise<Removed> {
  const totals = await uploadedTotals(db);
  if (totals.accounts === 0) return null;
  const first = await db.accounts.findFirst({
    where: { source: "csv" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  await db.accounts.deleteMany({ where: { source: "csv" } });
  await record(db.userId, "uploads_reset", totals);
  return { ...totals, jobId: await refreshAfterRemoval(db, first?.createdAt ?? new Date(0)) };
}
