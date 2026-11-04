import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { systemDb } from "@/lib/system-db";

const WHY =
  "The watch reads whether each scheduled job last worked; a job belongs to no one person";
const RUNS_PER_JOB_READ = 200;

export type JobState = {
  name: string;
  lastOk: boolean;
  lastFinishedAt: string;
  // Whether the run before that worked: a job that was already failing isn't this deploy's fault.
  previousOk: boolean | null;
};

export async function jobStates({
  client = defaultClient,
}: { client?: PrismaClient } = {}): Promise<JobState[]> {
  const runs = await systemDb(WHY, client).cronRun.findMany({
    where: { finishedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    take: RUNS_PER_JOB_READ,
    select: { name: true, ok: true, finishedAt: true },
  });
  const byName = new Map<string, typeof runs>();
  for (const run of runs) byName.set(run.name, [...(byName.get(run.name) ?? []), run]);
  return [...byName.entries()].map(([name, [last, previous]]) => ({
    name,
    lastOk: last.ok === true,
    lastFinishedAt: (last.finishedAt as Date).toISOString(),
    previousOk: previous ? previous.ok === true : null,
  }));
}

const EVIDENCE_HOURS = 24;
const EVIDENCE_ERRORS = 30;
const EVIDENCE_TEXT = 300;

export type ErrorSummary = { path: string | null; message: string; count: number; lastAt: string };

// What the reader agent sees (docs/ops.md): recent server errors, grouped. Already scrubbed of
// personal data when stored (src/lib/error-log.ts), with no user id. The words can still be an
// attacker's, which is why nothing the reader says can cause anything.
export async function recentErrors({
  client = defaultClient,
  now = new Date(),
}: { client?: PrismaClient; now?: Date } = {}): Promise<ErrorSummary[]> {
  const rows = await systemDb(WHY, client).errorEvent.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - EVIDENCE_HOURS * 3_600_000) } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { path: true, message: true, createdAt: true },
  });
  const groups = new Map<string, ErrorSummary>();
  for (const row of rows) {
    const message = row.message.slice(0, EVIDENCE_TEXT);
    const key = `${row.path}|${message}`;
    const seen = groups.get(key);
    if (seen) seen.count += 1;
    else
      groups.set(key, { path: row.path, message, count: 1, lastAt: row.createdAt.toISOString() });
  }
  return [...groups.values()].toSorted((a, b) => b.count - a.count).slice(0, EVIDENCE_ERRORS);
}
