import { STATEMENT_TRIAL_ID_PREFIX, TRIAL_ID_PREFIX } from "@/config/trial";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuditEvent } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { isStatementTrialUser } from "@/lib/trial-ids";

// Deleting trial people, kept apart from src/lib/trial.ts so the daily retention run doesn't load
// the bank sync. Deleting the user removes everything they own (every user-owned table cascades
// from users: src/lib/statement-trial.integration.test.ts fails if one stops). For
// someone trying Jane with their own statement, what the cascade can't reach goes too: their
// queued jobs, their counters and their audit rows, all but a record that they started and were
// deleted, which holds a random id and the times, and nothing from the statement.

export const STATEMENT_TRIAL_STARTED = "statement_trial_started" satisfies AuditEvent;
export const STATEMENT_TRIAL_DELETED = "statement_trial_deleted" satisfies AuditEvent;

// Why a temporary person went: never anything about them.
export type DeleteReason =
  "start_over" | "started_again" | "signed_out" | "expired" | "failed_start";

type Options = { client?: PrismaClient; now?: Date };

const RETRIES = 3;
const RETRY_MS = 200;

// An upload still working in the background can deadlock with the cascade: it is tried again.
async function deleteUsers(client: PrismaClient, where: Prisma.UserWhereInput): Promise<number> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return (await client.user.deleteMany({ where })).count;
    } catch (error) {
      if (attempt >= RETRIES) throw error;
      console.warn("Deleting trial people had to try again", { attempt });
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS * attempt));
    }
  }
}

// What of a temporary person the cascade can't reach, then the record that they're gone. A job
// already running keeps its row, with nothing but the random id, and ends as "person gone"
// (src/lib/jobs.ts).
async function removeTraces(
  ids: string[],
  reason: DeleteReason,
  actor: "user" | "system",
  { client, now }: Required<Options>,
) {
  if (ids.length === 0) return;
  await client.$executeRaw`DELETE FROM jobs
    WHERE status <> 'running' AND payload->>'userId' = ANY(${ids}::text[])`;
  await client.$executeRaw`DELETE FROM rate_limits WHERE split_part(key, ':', 2) = ANY(${ids}::text[])`;
  await client.$executeRaw`DELETE FROM audit_log
    WHERE event <> ${STATEMENT_TRIAL_STARTED}
      AND (actor_id = ANY(${ids}::text[])
        OR target_id = ANY(${ids}::text[])
        OR metadata->>'user_id' = ANY(${ids}::text[]))`;
  await client.auditLog.createMany({
    data: ids.map((id) => ({
      actorType: actor,
      actorId: actor === "user" ? id : null,
      event: STATEMENT_TRIAL_DELETED,
      targetType: "user",
      targetId: id,
      metadata: { reason },
      createdAt: now,
    })),
  });
}

// One temporary person, now. Only someone with a trial id can ever go through here, whatever the
// caller passes. Returns whether anyone was deleted.
export async function deleteTrialPerson(
  userId: string,
  reason: DeleteReason,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  if (!userId.startsWith(TRIAL_ID_PREFIX)) throw new Error("Only a trial person can go here");
  const count = await deleteUsers(client, { id: userId });
  if (count === 0) return false;
  if (isStatementTrialUser(userId)) {
    await removeTraces([userId], reason, reason === "expired" ? "system" : "user", { client, now });
  }
  return true;
}

// Every trial person made before `before`, with what the cascade can't reach of those trying Jane
// with their own statement. Both clean-ups come here: each new trial and the daily retention run.
export async function deleteExpiredTrials(
  before: Date,
  {
    client = defaultClient,
    now = new Date(),
    only,
  }: Options & { only?: Prisma.UserWhereInput } = {},
): Promise<number> {
  const where: Prisma.UserWhereInput = {
    id: { startsWith: TRIAL_ID_PREFIX },
    createdAt: { lt: before },
    ...(only ? { AND: [only] } : {}),
  };
  const own = await client.user.findMany({
    where: { AND: [where, { id: { startsWith: STATEMENT_TRIAL_ID_PREFIX } }] },
    select: { id: true },
  });
  const count = await deleteUsers(client, where);
  await removeTraces(
    own.map((p) => p.id),
    "expired",
    "system",
    { client, now },
  );
  // The rows of jobs that were still running when their person went, now finished.
  await client.$executeRaw`DELETE FROM jobs
    WHERE status <> 'running'
      AND starts_with(payload->>'userId', ${STATEMENT_TRIAL_ID_PREFIX})
      AND NOT EXISTS (SELECT 1 FROM users WHERE users.id = jobs.payload->>'userId')`;
  return count;
}
