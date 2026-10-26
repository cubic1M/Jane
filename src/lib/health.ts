import { DAILY_JOBS, HEALTH_ERROR_HOURS, JOB_STALE_HOURS } from "@/config/health";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import type { Admin } from "@/lib/concierge";
import { db as defaultClient } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { scrub } from "@/lib/scrub";

// Knowing when something quietly stops: every scheduled run is recorded, /admin/health
// shows the latest of each, and a daily job that hasn't succeeded in JOB_STALE_HOURS is
// emailed to the team once per outage. The check runs at the start of every scheduled
// job, so one job reports the other; if every job stops, the health page still shows it.

type Options = { client?: PrismaClient; now?: Date; send?: typeof sendEmail };

const HOUR = 60 * 60 * 1000;
const ERROR_LENGTH = 500;

// Runs a scheduled job, recording when it started and finished and how it went.
export async function recordRun<T>(
  name: string,
  run: () => Promise<T>,
  {
    client = defaultClient,
    now = () => new Date(),
  }: { client?: PrismaClient; now?: () => Date } = {},
): Promise<T> {
  const started = await client.cronRun.create({
    data: { name, startedAt: now() },
    select: { id: true },
  });
  try {
    const result = await run();
    await client.cronRun.update({
      where: { id: started.id },
      data: {
        finishedAt: now(),
        ok: true,
        summary: (result ?? null) as Prisma.InputJsonValue,
      },
    });
    // The job is back: a later outage gets its own email.
    await client.healthNotice.deleteMany({ where: { key: `missed:${name}` } });
    return result;
  } catch (error) {
    await client.cronRun.update({
      where: { id: started.id },
      data: { finishedAt: now(), ok: false, error: scrub(String(error)).slice(0, ERROR_LENGTH) },
    });
    throw error;
  }
}

export type JobHealth = {
  name: string;
  lastRunAt: Date | null;
  lastOk: boolean | null;
  lastSuccessAt: Date | null;
  missed: boolean;
};

export async function jobHealth({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<JobHealth[]> {
  const staleBefore = new Date(now.getTime() - JOB_STALE_HOURS * HOUR);
  return Promise.all(
    DAILY_JOBS.map(async (name) => {
      const [last, lastSuccess, first] = await Promise.all([
        client.cronRun.findFirst({
          where: { name },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true, ok: true },
        }),
        client.cronRun.findFirst({
          where: { name, ok: true },
          orderBy: { finishedAt: "desc" },
          select: { finishedAt: true },
        }),
        client.cronRun.findFirst({
          where: { name },
          orderBy: { startedAt: "asc" },
          select: { startedAt: true },
        }),
      ]);
      const lastSuccessAt = lastSuccess?.finishedAt ?? null;
      return {
        name,
        lastRunAt: last?.startedAt ?? null,
        lastOk: last?.ok ?? null,
        lastSuccessAt,
        // A job that has never run isn't "missed" yet: it may just be new. One that has run
        // for longer than that without ever succeeding is.
        missed:
          lastSuccessAt !== null
            ? lastSuccessAt < staleBefore
            : first !== null && first.startedAt < staleBefore,
      };
    }),
  );
}

export const teamEmails = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

// Emails the team about each missed daily job, once per outage.
export async function reportMissedJobs({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
}: Options = {}): Promise<string[]> {
  const missed = (await jobHealth({ client, now })).filter((j) => j.missed);
  const reported: string[] = [];
  for (const job of missed) {
    const key = `missed:${job.name}`;
    // Claims the report, so two jobs checking at once send one email.
    const { count } = await client.healthNotice.createMany({
      data: [{ key, reportedAt: now }],
      skipDuplicates: true,
    });
    if (count === 0) continue;
    const to = teamEmails();
    if (to.length > 0) {
      try {
        const message = {
          subject: job.lastSuccessAt
            ? `Daily job "${job.name}" hasn't run since ${job.lastSuccessAt.toISOString().slice(0, 16)} UTC`
            : `Daily job "${job.name}" has never run successfully`,
          text: `The "${job.name}" job hasn't finished successfully for over ${JOB_STALE_HOURS} hours. Check /admin/health and the Vercel cron logs. You'll get one email per outage.`,
          html: `<p>The "${job.name}" job hasn't finished successfully for over ${JOB_STALE_HOURS} hours. Check <a href="${process.env.APP_URL ?? ""}/admin/health">/admin/health</a> and the Vercel cron logs.</p><p>You'll get one email per outage.</p>`,
        };
        await Promise.all(to.map((address) => send({ ...message, to: address })));
      } catch (error) {
        // Unclaim, so the next check tries again.
        await client.healthNotice.deleteMany({ where: { key } });
        console.error("Health email failed", { job: job.name, error: String(error) });
        continue;
      }
    }
    reported.push(job.name);
  }
  return reported;
}

// Everything /admin/health shows. Admin-only, and audit-logged.
export async function healthReport(
  admin: Admin,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const since = new Date(now.getTime() - HEALTH_ERROR_HOURS * HOUR);
  const [jobs, items, lastSync, jobCounts, errors] = await Promise.all([
    jobHealth({ client, now }),
    client.plaidItem.groupBy({ by: ["status"], _count: { _all: true } }),
    client.plaidItem.findFirst({
      where: { lastSyncedAt: { not: null } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
    client.job.groupBy({ by: ["status"], _count: { _all: true } }),
    client.errorEvent.count({ where: { createdAt: { gte: since } } }),
  ]);
  await logAudit({ type: "admin", id: admin.id }, "admin_viewed_health", null, {});
  return {
    jobs,
    plaid: {
      items: Object.fromEntries(items.map((i) => [i.status, i._count._all])),
      lastSyncedAt: lastSync?.lastSyncedAt ?? null,
    },
    backgroundJobs: Object.fromEntries(jobCounts.map((j) => [j.status, j._count._all])),
    errorsLastDay: errors,
  };
}
