import { ACCESS_EVENTS } from "@/config/access-log";
import { KEEP_RATE_LIMIT_PREFIXES } from "@/config/rate-limits";
import {
  INACTIVE_ITEM_DAYS,
  REMOVAL_WARNING_DAYS,
  RETENTION_PERIODS,
  type RetainedKind,
} from "@/config/retention";
import { SNAPSHOT_RETENTION_DAYS } from "@/config/net-worth";
import type { PrismaClient } from "@/generated/prisma/client";
import { log } from "@/lib/log";
import { db as defaultClient } from "@/lib/db";
import { DAY_MS as DAY } from "@/lib/dates";
import { deleteExpiredTrials } from "@/lib/trial-delete";
import { systemDb } from "@/lib/system-db";

const WHY = "Retention deletes old rows across people";

// The daily cleanup, and the privacy policy's retention section, both from the periods
// in src/config/retention.ts.

// Deletes everything past its period. Returns how many of each were removed.
export async function runRetention({
  client = defaultClient,
  now = new Date(),
  skipTrials = false,
}: { client?: PrismaClient; now?: Date; skipTrials?: boolean } = {}): Promise<
  Record<RetainedKind, number>
> {
  const before = (kind: RetainedKind) =>
    new Date(now.getTime() - RETENTION_PERIODS[kind].days * DAY);
  const [analytics, activity, errors, jobs, runs, limits, sessions, links, access] =
    await Promise.all([
      systemDb(WHY, client).analyticsEvent.deleteMany({
        where: { createdAt: { lt: before("analyticsEvents") } },
      }),
      systemDb(WHY, client).activityEvent.deleteMany({
        where: { createdAt: { lt: before("activityEvents") } },
      }),
      systemDb(WHY, client).errorEvent.deleteMany({
        where: { createdAt: { lt: before("errorEvents") } },
      }),
      systemDb(WHY, client).job.deleteMany({
        where: { status: { in: ["done", "failed"] }, updatedAt: { lt: before("finishedJobs") } },
      }),
      systemDb(WHY, client).cronRun.deleteMany({
        where: { startedAt: { lt: before("cronRuns") } },
      }),
      systemDb(WHY, client).rateLimit.deleteMany({
        where: {
          windowStart: { lt: before("rateLimits") },
          NOT: KEEP_RATE_LIMIT_PREFIXES.map((prefix) => ({ key: { startsWith: prefix } })),
        },
      }),
      systemDb(WHY, client).session.deleteMany({
        where: { expires: { lt: before("expiredSessions") } },
      }),
      systemDb(WHY, client).verificationToken.deleteMany({
        where: { expires: { lt: before("expiredSessions") } },
      }),
      // Only the access log's entries: the rest of the audit log (consents, decisions) stays.
      systemDb(WHY, client).auditLog.deleteMany({
        where: { event: { in: [...ACCESS_EVENTS] }, createdAt: { lt: before("accessLog") } },
      }),
    ]);
  // What deleting an account leaves out of the audit log now, for people deleted before it did. The
  // table has no tie to users, so nothing else ever removes these.
  const orphans = await systemDb("Retention deletes old rows across people", client).$executeRaw`
    DELETE FROM audit_log a
    WHERE a.event <> ALL(${[...ACCESS_EVENTS]}::text[])
      AND (
        (a.actor_type = 'user' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.actor_id))
        OR (
          a.actor_type = 'system'
          AND a.metadata ->> 'user_id' IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.metadata ->> 'user_id')
        )
      )`;
  // Spec step 138: everything a trial person owns goes with them (it all cascades). After
  // the rest, not alongside: the cascade deletes sessions too, and the two deletes at once
  // can deadlock.
  // The nightly cron has already tried, first and on its own, and reported any failure
  // (skipTrials). Here too it's never a reason to stop: a person who won't delete must not cost
  // everyone else what runs after retention.
  let trials = 0;
  if (!skipTrials) {
    try {
      const { deleted, failed } = await deleteExpiredTrials(before("trialPeople"), { client, now });
      trials = deleted;
      if (failed > 0) log.error("Some trial people couldn't be deleted", { failed });
    } catch (error) {
      log.error("Deleting trial people failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return {
    analyticsEvents: analytics.count,
    activityEvents: activity.count,
    errorEvents: errors.count,
    finishedJobs: jobs.count,
    cronRuns: runs.count,
    rateLimits: limits.count,
    expiredSessions: sessions.count + links.count,
    accessLog: access.count + orphans,
    trialPeople: trials,
  };
}

function period(days: number): string {
  if (days === 0) return "deleted";
  if (days === 1) return "kept for a day";
  if (days % 365 === 0) return `kept for ${days / 365} year${days === 365 ? "" : "s"}`;
  return `kept for ${days} days`;
}

// The privacy policy's retention list, one sentence each.
export function retentionPolicy(): string[] {
  return [
    `If you don't use the app for ${INACTIVE_ITEM_DAYS} days, we disconnect your banks (we email you ${REMOVAL_WARNING_DAYS} days before).`,
    `Daily balances for your net worth history: ${period(SNAPSHOT_RETENTION_DAYS)}.`,
    ...Object.values(RETENTION_PERIODS).map((p) => `${p.policy}: ${period(p.days)}.`),
  ];
}
