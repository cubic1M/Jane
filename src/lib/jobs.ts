import { countTry } from "@/lib/try-stats";
import { isStatementTrialUser } from "@/lib/trial-ids";
import {
  JOB_BACKOFF_MINUTES,
  JOB_BATCH,
  JOB_ERROR_LENGTH,
  JOB_GRACE_MS,
  JOB_MAX_ATTEMPTS,
  JOB_STUCK_MINUTES,
} from "@/config/jobs";
import type { PrismaClient } from "@/generated/prisma/client";
import { finishImport } from "@/lib/import/background";
import { db as defaultClient } from "@/lib/db";
import { agentStep, handleReply, lookUpSupportFor } from "@/lib/agent/run";
import { simulatedReply } from "@/lib/agent/simulated-company";
import { log, logText } from "@/lib/log";
import { simulatedCallResult } from "@/lib/voice/calls";
import { explainFindings } from "@/lib/explanations";
import { deliverChatNotifications } from "@/lib/jane-agent/notify";
import { retryControllerStep, runController } from "@/lib/controller";
import type { OnlyPeople } from "@/lib/only-people";
import { systemDb } from "@/lib/system-db";
import { executeAction } from "@/lib/connectors/pipeline";

const WHY = "The job queue works across people";

// A small job queue in Postgres for slow work that can fail and be retried. A job is
// claimed with FOR UPDATE SKIP LOCKED, so two runners never take the same one; a failure
// is retried after a growing wait, and after JOB_MAX_ATTEMPTS it's marked failed and shown
// on /admin/jobs. Payloads hold ids only.

export type JobKind =
  | "explain_findings"
  | "agent_step"
  | "agent_simulated_reply"
  | "voice_simulated_result"
  | "find_support_contact"
  // Jane's chat messages as notifications (spec step 85).
  | "chat_notify"
  // The nightly controller run (spec step 142), and the retry of one failed step.
  | "controller_run"
  | "controller_step"
  // An upload's work after its rows are saved (src/lib/import/background.ts).
  | "import_finish"
  // A connector action the person said yes to, once its hold is over (src/lib/connectors/).
  | "connector_execute";
export type JobPayload = { userId: string; actionId?: string; step?: string; importRunId?: string };
// Tests pass only the handlers they need; a job with no handler fails like any error.
export type Handlers = Partial<Record<JobKind, (payload: JobPayload) => Promise<unknown>>>;

const actionIdOf = (payload: JobPayload) => {
  if (!payload.actionId) throw new Error("This job needs an actionId");
  return payload.actionId;
};

export const HANDLERS: Required<Handlers> = {
  explain_findings: ({ userId }) => explainFindings(userId),
  agent_step: (payload) => agentStep(payload.userId, actionIdOf(payload)),
  agent_simulated_reply: (payload) =>
    simulatedReply(payload.userId, actionIdOf(payload), {
      deliver: (toAddress, mail) => handleReply(toAddress, mail),
    }),
  voice_simulated_result: (payload) => simulatedCallResult(payload.userId, actionIdOf(payload)),
  find_support_contact: (payload) => lookUpSupportFor(payload.userId, actionIdOf(payload)),
  chat_notify: ({ userId }) => deliverChatNotifications(userId),
  controller_run: ({ userId }) => runController(userId),
  controller_step: ({ userId, step }) => retryControllerStep(userId, step ?? ""),
  connector_execute: (payload) => executeAction(payload.userId, actionIdOf(payload)),
  import_finish: async (payload) => {
    if (!payload.importRunId) throw new Error("This job needs an importRunId");
    const finished = await finishImport(payload.userId, payload.importRunId);
    if (isStatementTrialUser(payload.userId)) await countTry("scan_finished");
    return finished;
  },
};

type Options = { client?: PrismaClient; now?: Date; handlers?: Handlers };

type Claimed = {
  was_stuck: boolean;
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
};

const MINUTE = 60 * 1000;

export function backoffMs(attempts: number): number {
  const minutes = JOB_BACKOFF_MINUTES[Math.min(attempts, JOB_BACKOFF_MINUTES.length) - 1] ?? 1;
  return minutes * MINUTE;
}

export async function enqueueJob(
  kind: JobKind,
  payload: JobPayload,
  // runAt: not before this (e.g. after the time a person has to take something back).
  { client = defaultClient, now = new Date(), runAt = now }: Options & { runAt?: Date } = {},
): Promise<string> {
  const job = await systemDb(WHY, client).job.create({
    data: { kind, payload, runAt, maxAttempts: JOB_MAX_ATTEMPTS },
    select: { id: true },
  });
  return job.id;
}

// `userIds`: only jobs for those people (by the payload's userId).
async function claim(
  client: PrismaClient,
  now: Date,
  limit: number,
  id?: string,
  userIds?: readonly string[],
) {
  const stuckBefore = new Date(now.getTime() - JOB_STUCK_MINUTES * MINUTE);
  const people = userIds ? [...userIds] : null;
  // A job that was killed never reaches its catch, so its attempts are counted here: without this
  // it runs forever, and each run takes the runner down with it. It then shows on /admin/jobs.
  await systemDb(WHY, client).$executeRaw`
    UPDATE jobs SET status = 'failed', last_error = ${OUT_OF_ATTEMPTS}, updated_at = ${now}
    WHERE status = 'running' AND updated_at < ${stuckBefore} AND attempts >= max_attempts`;
  const claimed = await systemDb(WHY, client).$queryRaw<Claimed[]>`
    WITH picked AS (
      SELECT id, status = 'running' AS was_stuck FROM jobs
      WHERE ((status = 'queued' AND run_at <= ${now})
             OR (status = 'running' AND updated_at < ${stuckBefore}))
        AND (${id ?? null}::text IS NULL OR id = ${id ?? null})
        AND (${people}::text[] IS NULL OR payload->>'userId' = ANY(${people}::text[]))
      ORDER BY (status = 'running'), run_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ${now}
    FROM picked WHERE jobs.id = picked.id
    RETURNING jobs.id, kind, payload, attempts, max_attempts, picked.was_stuck`;
  // A job that took its last runner down goes behind the work that's waiting. RETURNING has no order.
  return claimed.sort((a, b) => Number(a.was_stuck) - Number(b.was_stuck));
}

const OUT_OF_ATTEMPTS = "It was stopped each time before it could finish";
const OUT_OF_TIME = "It ran out of the runner's time";

// The runner's clock is otherwise only read between jobs, so one long job would take everything
// after it (clean-up, retention) down with it. The job isn't stopped, only no longer waited for.
function withinTime(work: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout>;
  const out = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(OUT_OF_TIME)), Math.max(ms, 0));
  });
  return Promise.race([work, out]).finally(() => clearTimeout(timer));
}

const PERSON_GONE = "The person is gone";
// Prisma's code for a foreign key failure.
const FOREIGN_KEY_ERROR = "P2003";

async function personGone(error: unknown, payload: JobPayload, client: PrismaClient) {
  if ((error as { code?: unknown } | null)?.code !== FOREIGN_KEY_ERROR) return false;
  if (!payload?.userId) return false;
  const user = await systemDb(WHY, client).user.findUnique({
    where: { id: payload.userId },
    select: { id: true },
  });
  return user === null;
}

async function execute(
  job: Claimed,
  client: PrismaClient,
  now: Date,
  handlers: Handlers,
  timeLeftMs?: number,
) {
  const handler = handlers[job.kind as JobKind];
  try {
    if (!handler) throw new Error(`Unknown job kind: ${job.kind}`);
    const work = handler(job.payload as JobPayload);
    await (timeLeftMs === undefined ? work : withinTime(work, timeLeftMs));
    await systemDb(WHY, client).job.update({
      where: { id: job.id },
      data: { status: "done", lastError: null },
    });
    return "done" as const;
  } catch (error) {
    // Their person was deleted with the job still queued (a trial person's day ending): it can
    // never work, and retrying spends the cron's time (debugger 11-02).
    if (await personGone(error, job.payload as JobPayload, client)) {
      await systemDb(WHY, client).job.update({
        where: { id: job.id },
        data: { status: "done", lastError: PERSON_GONE },
      });
      return "done" as const;
    }
    // As in the logs: an error can quote a row of someone's statement.
    const lastError = logText(String(error)).slice(0, JOB_ERROR_LENGTH);
    const failed = job.attempts >= job.max_attempts;
    if (
      failed &&
      job.kind === "import_finish" &&
      isStatementTrialUser((job.payload as JobPayload)?.userId)
    ) {
      await countTry("scan_failed", { client, now });
    }
    // A job out of time may still be running: it isn't stopped, only no longer waited for. Not again
    // until the function it's in has certainly ended, or two copies could run at once.
    const wait =
      error instanceof Error && error.message === OUT_OF_TIME
        ? (timeLeftMs ?? 0) + Math.max(backoffMs(job.attempts), JOB_STUCK_MINUTES * MINUTE)
        : backoffMs(job.attempts);
    await systemDb(WHY, client).job.update({
      where: { id: job.id },
      data: failed
        ? { status: "failed", lastError }
        : { status: "queued", lastError, runAt: new Date(now.getTime() + wait) },
    });
    log.error("Job failed", {
      id: job.id,
      kind: job.kind,
      attempts: job.attempts,
      final: failed,
      error: lastError,
    });
    return failed ? ("failed" as const) : ("retried" as const);
  }
}

// Runs every job that's due, up to JOB_BATCH.
// `budgetMs`: stop after the job that uses it up and put the ones claimed but not reached back
// as they were, for the next runner (debugger 10-31: the daily crons ran 20 controller runs of
// up to 25 s each with no clock, past their limit, and returned 504).
export async function runDueJobs({
  client = defaultClient,
  now = new Date(),
  handlers = HANDLERS,
  userIds,
  budgetMs,
  clock = Date.now,
  graceMs = JOB_GRACE_MS,
}: Options &
  OnlyPeople & { budgetMs?: number; clock?: () => number; graceMs?: number } = {}): Promise<{
  done: number;
  retried: number;
  failed: number;
}> {
  const counts = { done: 0, retried: 0, failed: 0 };
  const started = clock();
  const claimed = await claim(client, now, JOB_BATCH, undefined, userIds);
  for (const [i, job] of claimed.entries()) {
    if (budgetMs !== undefined && clock() - started >= budgetMs) {
      await systemDb(WHY, client).job.updateMany({
        where: { id: { in: claimed.slice(i).map((j) => j.id) }, status: "running" },
        data: { status: "queued", attempts: { decrement: 1 } },
      });
      break;
    }
    const left = budgetMs === undefined ? undefined : budgetMs - (clock() - started) + graceMs;
    counts[await execute(job, client, now, handlers, left)] += 1;
  }
  return counts;
}

// Runs one job now, if it's due and nobody else has it. Failures are recorded for retry,
// never thrown, so the caller's own work isn't affected.
export async function runJob(
  id: string,
  { client = defaultClient, now = new Date(), handlers = HANDLERS }: Options = {},
): Promise<"done" | "retried" | "failed" | "not_due"> {
  const [job] = await claim(client, now, 1, id);
  return job ? execute(job, client, now, handlers) : "not_due";
}

// The team's "Retry" on /admin/jobs: a failed job gets another full set of attempts.
export async function retryJob(
  id: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const { count } = await systemDb(WHY, client).job.updateMany({
    where: { id, status: "failed" },
    data: { status: "queued", attempts: 0, runAt: now },
  });
  return count > 0;
}
