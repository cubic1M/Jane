import { TRIAL_CLEANUP_BUDGET_MS, TRIAL_SWEEP_LOOKBACK_DAYS } from "@/config/statement-trial";
import { STATEMENT_TRIAL_ID_PREFIX, TRIAL_HOURS, TRIAL_ID_PREFIX } from "@/config/trial";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuditEvent } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { log } from "@/lib/log";
import { systemDb, systemTransaction } from "@/lib/system-db";
import { isStatementTrialUser } from "@/lib/trial-ids";

// Deleting trial people, kept apart from src/lib/trial.ts so the daily retention run doesn't load
// the bank sync. Deleting the user removes everything they own (every user-owned table cascades
// from users: src/lib/statement-trial.integration.test.ts fails if one stops). For someone trying
// Jane with their own statement, what the cascade can't reach goes in the same transaction: their
// queued jobs, their counters and their audit rows, all but a record that they started and were
// deleted, which holds a random id and the times, and nothing from the statement. So a failure
// leaves the person there to be deleted again, never a person gone with traces left behind.

export const STATEMENT_TRIAL_STARTED = "statement_trial_started" satisfies AuditEvent;
export const STATEMENT_TRIAL_DELETED = "statement_trial_deleted" satisfies AuditEvent;

// Why a temporary person went: never anything about them.
export type DeleteReason =
  "start_over" | "started_again" | "signed_out" | "expired" | "failed_start";

type Options = { client?: PrismaClient; now?: Date };

const RETRIES = 3;
const RETRY_MS = 200;
const HOUR_MS = 60 * 60 * 1000;
// A person with a year of rows, on a busy database: the cascade is the slow part.
const TRANSACTION = { maxWait: 10_000, timeout: 30_000 };

// An upload still working in the background can deadlock with the cascade: it is tried again.
async function withRetries<T>(run: () => Promise<T>, outOfTime = () => false): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= RETRIES || outOfTime()) throw error;
      log.warn("Deleting trial people had to try again", { attempt });
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS * attempt));
    }
  }
}

// One temporary person and everything of theirs, all or nothing. A job already running keeps its
// row, with nothing but the random id, and ends as "person gone" (src/lib/jobs.ts).
async function deleteStatementPerson(
  userId: string,
  reason: DeleteReason,
  actor: "user" | "system",
  { client, now }: Required<Options>,
  outOfTime?: () => boolean,
): Promise<boolean> {
  return withRetries(
    () =>
      systemTransaction(
        "Deleting a temporary person and what the cascade can't reach, all or nothing",
        async (tx) => {
          const { count } = await tx.user.deleteMany({ where: { id: userId } });
          if (count === 0) return false;
          await tx.$executeRaw`DELETE FROM jobs
        WHERE status <> 'running' AND payload->>'userId' = ${userId}`;
          await tx.$executeRaw`DELETE FROM rate_limits WHERE split_part(key, ':', 2) = ${userId}`;
          await tx.$executeRaw`DELETE FROM audit_log
        WHERE event <> ${STATEMENT_TRIAL_STARTED}
          AND (actor_id = ${userId} OR target_id = ${userId} OR metadata->>'user_id' = ${userId})`;
          await tx.auditLog.create({
            data: {
              actorType: actor,
              actorId: actor === "user" ? userId : null,
              event: STATEMENT_TRIAL_DELETED,
              targetType: "user",
              targetId: userId,
              metadata: { reason },
              createdAt: now,
            },
          });
          return true;
        },
        client,
        TRANSACTION,
      ),
    outOfTime,
  );
}

// One temporary person, now. Only someone with a trial id can ever go through here, whatever the
// caller passes. Returns whether anyone was deleted.
export async function deleteTrialPerson(
  userId: string,
  reason: DeleteReason,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  if (!userId.startsWith(TRIAL_ID_PREFIX)) throw new Error("Only a trial person can go here");
  if (isStatementTrialUser(userId)) {
    const actor = reason === "expired" ? "system" : "user";
    return deleteStatementPerson(userId, reason, actor, { client, now });
  }
  const { count } = await withRetries(() =>
    systemDb(
      "Deleting one sample person: no one is signed in as them here",
      client,
    ).user.deleteMany({ where: { id: userId } }),
  );
  return count > 0;
}

// What a step still running wrote after its person went: a counter, an audit row, its finished job.
// None of it can be written against a user that's gone, so it's cleared here, once a day. Only ids
// with no user: never the start and delete records, never anyone still here. A scan of three tables,
// so not on a night when nobody has been deleted lately, which is every night with this path off.
export async function sweepLateWrites({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<boolean> {
  const since = new Date(now.getTime() - TRIAL_SWEEP_LOOKBACK_DAYS * 24 * HOUR_MS);
  const system = systemDb("The daily sweep of what steps wrote after their person went", client);
  const recent = await system.auditLog.findFirst({
    where: { event: STATEMENT_TRIAL_DELETED, createdAt: { gte: since } },
    select: { id: true },
  });
  if (!recent) return false;
  await system.$executeRaw`DELETE FROM jobs
    WHERE status <> 'running'
      AND starts_with(payload->>'userId', ${STATEMENT_TRIAL_ID_PREFIX})
      AND NOT EXISTS (SELECT 1 FROM users WHERE users.id = jobs.payload->>'userId')`;
  await system.$executeRaw`DELETE FROM rate_limits
    WHERE starts_with(split_part(key, ':', 2), ${STATEMENT_TRIAL_ID_PREFIX})
      AND NOT EXISTS (SELECT 1 FROM users WHERE users.id = split_part(rate_limits.key, ':', 2))`;
  await system.$executeRaw`DELETE FROM audit_log
    WHERE event NOT IN (${STATEMENT_TRIAL_STARTED}, ${STATEMENT_TRIAL_DELETED})
      AND EXISTS (
        SELECT 1 FROM unnest(ARRAY[actor_id, target_id, metadata->>'user_id']) AS who
        WHERE starts_with(who, ${STATEMENT_TRIAL_ID_PREFIX})
          AND NOT EXISTS (SELECT 1 FROM users WHERE users.id = who)
      )`;
  return true;
}

export type TrialCleanup = { deleted: number; failed: number };

// Every trial person made before `before`, with what the cascade can't reach of those trying Jane
// with their own statement. Each one is its own transaction, so one that fails doesn't keep the
// rest, and it's tried again next time. Past the budget the rest wait for next time too, counted as
// failed. It never throws over one person: only the cron's first step tells anyone
// (deleteTrialsPastTheirTime), and nothing that runs later has to answer for it.
export async function deleteExpiredTrials(
  before: Date,
  {
    client = defaultClient,
    now = new Date(),
    only,
    budgetMs = TRIAL_CLEANUP_BUDGET_MS,
    clock = Date.now,
  }: Options & { only?: Prisma.UserWhereInput; budgetMs?: number; clock?: () => number } = {},
): Promise<TrialCleanup> {
  const started = clock();
  const outOfTime = () => clock() - started >= budgetMs;
  const where: Prisma.UserWhereInput = {
    id: { startsWith: TRIAL_ID_PREFIX },
    createdAt: { lt: before },
    ...(only ? { AND: [only] } : {}),
  };
  const system = systemDb("The clean-up of trial people past their time, across everyone", client);
  const own = await system.user.findMany({
    where: { AND: [where, { id: { startsWith: STATEMENT_TRIAL_ID_PREFIX } }] },
    select: { id: true },
  });
  let deleted = 0;
  let failed = 0;
  for (const [i, { id }] of own.entries()) {
    if (outOfTime()) {
      failed += own.length - i;
      break;
    }
    try {
      if (await deleteStatementPerson(id, "expired", "system", { client, now }, outOfTime)) {
        deleted += 1;
      }
    } catch {
      failed += 1;
    }
  }
  const sample = await withRetries(
    () =>
      system.user.deleteMany({
        where: { AND: [where, { NOT: { id: { startsWith: STATEMENT_TRIAL_ID_PREFIX } } }] },
      }),
    outOfTime,
  );
  return { deleted: deleted + sample.count, failed };
}

// Everyone whose time is up: the daily cron runs this first, by itself (src/app/api/cron/plaid-sync),
// so nothing else that night can keep the deletion the legal pages promise from happening. This is
// the one place a failure is reported: by throwing, for the cron to record and alert on.
export async function deleteTrialsPastTheirTime({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<number> {
  const { deleted, failed } = await deleteExpiredTrials(
    new Date(now.getTime() - TRIAL_HOURS * HOUR_MS),
    { client, now },
  );
  await sweepLateWrites({ client, now });
  if (failed > 0) throw new Error(`${failed} temporary people couldn't be deleted`);
  return deleted;
}
