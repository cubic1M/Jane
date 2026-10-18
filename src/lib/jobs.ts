import {
  JOB_BACKOFF_MINUTES,
  JOB_BATCH,
  JOB_ERROR_LENGTH,
  JOB_MAX_ATTEMPTS,
  JOB_STUCK_MINUTES,
} from "@/config/jobs";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { agentStep, handleReply } from "@/lib/agent/run";
import { simulatedReply } from "@/lib/agent/simulated-company";
import { simulatedCallResult } from "@/lib/voice/calls";
import { explainFindings } from "@/lib/explanations";
import { scrub } from "@/lib/scrub";

// A small job queue in Postgres for slow work that can fail and be retried. A job is
// claimed with FOR UPDATE SKIP LOCKED, so two runners never take the same one; a failure
// is retried after a growing wait, and after JOB_MAX_ATTEMPTS it's marked failed and shown
// on /admin/jobs. Payloads hold ids only.

export type JobKind =
  "explain_findings" | "agent_step" | "agent_simulated_reply" | "voice_simulated_result";
export type JobPayload = { userId: string; actionId?: string };
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
};

type Options = { client?: PrismaClient; now?: Date; handlers?: Handlers };

type Claimed = {
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
  const job = await client.job.create({
    data: { kind, payload, runAt, maxAttempts: JOB_MAX_ATTEMPTS },
    select: { id: true },
  });
  return job.id;
}

async function claim(client: PrismaClient, now: Date, limit: number, id?: string) {
  const stuckBefore = new Date(now.getTime() - JOB_STUCK_MINUTES * MINUTE);
  return client.$queryRaw<Claimed[]>`
    UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ${now}
    WHERE id IN (
      SELECT id FROM jobs
      WHERE ((status = 'queued' AND run_at <= ${now})
             OR (status = 'running' AND updated_at < ${stuckBefore}))
        AND (${id ?? null}::text IS NULL OR id = ${id ?? null})
      ORDER BY run_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload, attempts, max_attempts`;
}

async function execute(job: Claimed, client: PrismaClient, now: Date, handlers: Handlers) {
  const handler = handlers[job.kind as JobKind];
  try {
    if (!handler) throw new Error(`Unknown job kind: ${job.kind}`);
    await handler(job.payload as JobPayload);
    await client.job.update({ where: { id: job.id }, data: { status: "done", lastError: null } });
    return "done" as const;
  } catch (error) {
    const lastError = scrub(String(error)).slice(0, JOB_ERROR_LENGTH);
    const failed = job.attempts >= job.max_attempts;
    await client.job.update({
      where: { id: job.id },
      data: failed
        ? { status: "failed", lastError }
        : { status: "queued", lastError, runAt: new Date(now.getTime() + backoffMs(job.attempts)) },
    });
    console.error("Job failed", {
      id: job.id,
      kind: job.kind,
      attempts: job.attempts,
      final: failed,
    });
    return failed ? ("failed" as const) : ("retried" as const);
  }
}

// Runs every job that's due, up to JOB_BATCH.
export async function runDueJobs({
  client = defaultClient,
  now = new Date(),
  handlers = HANDLERS,
}: Options = {}): Promise<{ done: number; retried: number; failed: number }> {
  const counts = { done: 0, retried: 0, failed: 0 };
  for (const job of await claim(client, now, JOB_BATCH)) {
    counts[await execute(job, client, now, handlers)] += 1;
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
  const { count } = await client.job.updateMany({
    where: { id, status: "failed" },
    data: { status: "queued", attempts: 0, runAt: now },
  });
  return count > 0;
}
