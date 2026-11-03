import { DAILY_JOBS, HEALTH_ERROR_HOURS, JOB_STALE_HOURS } from "@/config/health";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import type { Admin } from "@/lib/concierge";
import { db as defaultClient } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { describeError } from "@/lib/error-log";
import { heartbeat } from "@/lib/heartbeat";
import { log } from "@/lib/log";
import { plaidEnvironment } from "@/lib/plaid/client";
import { bankConnectionsLine, itemSlotUse } from "@/lib/plaid/item-count";
import { loginCheck, rlsCoverage, rlsSwitchWorks, systemSwitchWorks } from "@/lib/rls-coverage";
import { scrub } from "@/lib/scrub";
import { reportToSentry } from "@/lib/sentry";
import { systemDb } from "@/lib/system-db";

const WHY = "Health checks read across people and write the system's own tables";

const WHY_COVERAGE = "Row-level security's own check: the catalog, and the rule's plan";

// Knowing when something quietly stops: every scheduled run is recorded, /admin/health
// shows the latest of each, and a daily job that hasn't succeeded in JOB_STALE_HOURS is
// emailed to the team once per outage. The check runs at the start of every scheduled
// job, so one job reports the other; if every job stops, the health page still shows it. The
// same check emails the team, once per lapse, when row-level security stops covering every
// user-owned table (src/lib/rls-coverage.ts).

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
  const started = await systemDb(WHY, client).cronRun.create({
    data: { name, startedAt: now() },
    select: { id: true },
  });
  await heartbeat(name, "start");
  try {
    const result = await run();
    await systemDb(WHY, client).cronRun.update({
      where: { id: started.id },
      data: {
        finishedAt: now(),
        ok: true,
        summary: (result ?? null) as Prisma.InputJsonValue,
      },
    });
    // The job is back: a later outage gets its own email.
    await systemDb(WHY, client).healthNotice.deleteMany({ where: { key: `missed:${name}` } });
    await heartbeat(name, "success");
    return result;
  } catch (error) {
    await systemDb(WHY, client).cronRun.update({
      where: { id: started.id },
      data: { finishedAt: now(), ok: false, error: scrub(String(error)).slice(0, ERROR_LENGTH) },
    });
    await heartbeat(name, "fail");
    await reportToSentry({ ...describeError(error), path: `/cron/${name}`, routeType: "cron" });
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
        systemDb(WHY, client).cronRun.findFirst({
          where: { name },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true, ok: true },
        }),
        systemDb(WHY, client).cronRun.findFirst({
          where: { name, ok: true },
          orderBy: { finishedAt: "desc" },
          select: { finishedAt: true },
        }),
        systemDb(WHY, client).cronRun.findFirst({
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

const RLS_NOTICE = "rls:coverage";

// Emails the team once when row-level security stops covering every user-owned table, and
// again only after it has been whole in between. True when it sent (or would have, with no team).
export async function reportRlsGaps({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
}: Options = {}): Promise<boolean> {
  const coverage = await rlsCoverage({ client: systemDb(WHY_COVERAGE, client) });
  // Once the deny-by-default login is meant to be in use (RLS_REQUIRED=1), going back is a gap too.
  const login = process.env.RLS_REQUIRED === "1" ? await loginCheck({ client }) : null;
  const loginGap = login !== null && !login.denied;
  if (coverage.ok && !loginGap) {
    await systemDb(WHY, client).healthNotice.deleteMany({ where: { key: RLS_NOTICE } });
    return false;
  }
  const { count } = await systemDb(WHY, client).healthNotice.createMany({
    data: [{ key: RLS_NOTICE, reportedAt: now }],
    skipDuplicates: true,
  });
  if (count === 0) return false;
  const what = coverage.ok
    ? `this server logs in as ${login?.login}, which can use tables by itself`
    : !coverage.role
      ? "the database has no jane_rls role"
      : coverage.tables.length === 0
        ? "no user-owned tables were found"
        : `${coverage.missing.length} of ${coverage.tables.length} user-owned tables aren't covered: ${coverage.missing.slice(0, 20).join(", ")}${coverage.missing.length > 20 ? ", ..." : ""}`;
  const to = teamEmails();
  try {
    const message = {
      subject: "Row-level security has a gap",
      text: `Row-level security (docs/security/rls.md) no longer covers every user-owned table: ${what}. The app's own filters still apply. Check /admin/health; the next deploy re-runs scripts/rls-protect.mjs. You'll get one email per lapse.`,
      html: `<p>Row-level security no longer covers every user-owned table: ${what}.</p><p>The app's own filters still apply. Check <a href="${process.env.APP_URL ?? ""}/admin/health">/admin/health</a>; the next deploy re-runs <code>scripts/rls-protect.mjs</code>.</p><p>You'll get one email per lapse.</p>`,
    };
    await Promise.all(to.map((address) => send({ ...message, to: address })));
  } catch (error) {
    await systemDb(WHY, client).healthNotice.deleteMany({ where: { key: RLS_NOTICE } });
    log.error("Row-level security email failed", { error: String(error) });
    return false;
  }
  return true;
}

const PLAID_SLOTS_NOTICE = "plaid:item-slots";

// Emails the team once when Plaid's Trial plan is nearly used up (it never gives a slot back), and
// again only after an upgrade took it back under the mark. True when it sent.
export async function reportPlaidSlots({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
}: Options = {}): Promise<boolean> {
  if (plaidEnvironment() !== "production") return false;
  const use = await itemSlotUse({ client });
  if (use.used < use.warnAt) {
    await systemDb(WHY, client).healthNotice.deleteMany({ where: { key: PLAID_SLOTS_NOTICE } });
    return false;
  }
  const { count } = await systemDb(WHY, client).healthNotice.createMany({
    data: [{ key: PLAID_SLOTS_NOTICE, reportedAt: now }],
    skipDuplicates: true,
  });
  if (count === 0) return false;
  const line = bankConnectionsLine(use);
  try {
    const message = {
      subject: `Plaid: ${line}`,
      text: `${line}. Removing a bank doesn't give one back on Plaid's Trial plan, so the app offers statement upload once they're gone. To get more, upgrade the plan: docs/setup/plaid-trial.md. You'll get one email about this.`,
      html: `<p>${line}.</p><p>Removing a bank doesn't give one back on Plaid's Trial plan, so the app offers statement upload once they're gone. To get more, upgrade the plan: <code>docs/setup/plaid-trial.md</code>.</p><p>You'll get one email about this.</p>`,
    };
    await Promise.all(teamEmails().map((address) => send({ ...message, to: address })));
  } catch (error) {
    await systemDb(WHY, client).healthNotice.deleteMany({ where: { key: PLAID_SLOTS_NOTICE } });
    log.error("Plaid connections email failed", { error: String(error) });
    return false;
  }
  return true;
}

// Emails the team about each missed daily job, once per outage, about a gap in row-level security
// ("row-level security" in what it returns) and about Plaid's Trial plan nearly used up.
export async function reportMissedJobs({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
}: Options = {}): Promise<string[]> {
  const missed = (await jobHealth({ client, now })).filter((j) => j.missed);
  const reported: string[] = [];
  try {
    if (await reportRlsGaps({ client, now, send })) reported.push("row-level security");
  } catch (error) {
    // Never stops the job report.
    log.error("Row-level security check failed", { error: String(error) });
  }
  try {
    if (await reportPlaidSlots({ client, now, send })) reported.push("plaid connections");
  } catch (error) {
    // Never stops the job report.
    log.error("Plaid connections check failed", { error: String(error) });
  }
  for (const job of missed) {
    const key = `missed:${job.name}`;
    // Claims the report, so two jobs checking at once send one email.
    const { count } = await systemDb(WHY, client).healthNotice.createMany({
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
        await systemDb(WHY, client).healthNotice.deleteMany({ where: { key } });
        log.error("Health email failed", { job: job.name, error: String(error) });
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
  const [jobs, items, lastSync, jobCounts, errors, coverage, switchWorks, systemSwitch, login] =
    await Promise.all([
      jobHealth({ client, now }),
      systemDb(WHY, client).plaidItem.groupBy({ by: ["status"], _count: { _all: true } }),
      systemDb(WHY, client).plaidItem.findFirst({
        where: { lastSyncedAt: { not: null } },
        orderBy: { lastSyncedAt: "desc" },
        select: { lastSyncedAt: true },
      }),
      systemDb(WHY, client).job.groupBy({ by: ["status"], _count: { _all: true } }),
      systemDb(WHY, client).errorEvent.count({ where: { createdAt: { gte: since } } }),
      rlsCoverage({ client: systemDb(WHY_COVERAGE, client) }),
      rlsSwitchWorks(admin.id, { client }).catch(() => false),
      systemSwitchWorks({ client }).catch(() => false),
      loginCheck({ client }),
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
    rls: { ...coverage, switchWorks, systemSwitch, login },
  };
}
