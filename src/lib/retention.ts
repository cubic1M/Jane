import { KEEP_RATE_LIMIT_PREFIXES } from "@/config/rate-limits";
import {
  INACTIVE_ITEM_DAYS,
  REMOVAL_WARNING_DAYS,
  RETENTION_PERIODS,
  type RetainedKind,
} from "@/config/retention";
import { SNAPSHOT_RETENTION_DAYS } from "@/config/net-worth";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { DAY_MS as DAY } from "@/lib/dates";

// The daily cleanup, and the privacy policy's retention section, both from the periods
// in src/config/retention.ts.

// Deletes everything past its period. Returns how many of each were removed.
export async function runRetention({
  client = defaultClient,
  now = new Date(),
}: { client?: PrismaClient; now?: Date } = {}): Promise<Record<RetainedKind, number>> {
  const before = (kind: RetainedKind) =>
    new Date(now.getTime() - RETENTION_PERIODS[kind].days * DAY);
  const [analytics, errors, jobs, runs, limits, sessions, links] = await Promise.all([
    client.analyticsEvent.deleteMany({ where: { createdAt: { lt: before("analyticsEvents") } } }),
    client.errorEvent.deleteMany({ where: { createdAt: { lt: before("errorEvents") } } }),
    client.job.deleteMany({
      where: { status: { in: ["done", "failed"] }, updatedAt: { lt: before("finishedJobs") } },
    }),
    client.cronRun.deleteMany({ where: { startedAt: { lt: before("cronRuns") } } }),
    client.rateLimit.deleteMany({
      where: {
        windowStart: { lt: before("rateLimits") },
        NOT: KEEP_RATE_LIMIT_PREFIXES.map((prefix) => ({ key: { startsWith: prefix } })),
      },
    }),
    client.session.deleteMany({ where: { expires: { lt: before("expiredSessions") } } }),
    client.verificationToken.deleteMany({ where: { expires: { lt: before("expiredSessions") } } }),
  ]);
  // Spec step 138: everything a trial person owns goes with them (it all cascades). After
  // the rest, not alongside: the cascade deletes sessions too, and the two deletes at once
  // can deadlock.
  const trials = await client.user.deleteMany({
    where: { id: { startsWith: TRIAL_ID_PREFIX }, createdAt: { lt: before("trialPeople") } },
  });
  return {
    analyticsEvents: analytics.count,
    errorEvents: errors.count,
    finishedJobs: jobs.count,
    cronRuns: runs.count,
    rateLimits: limits.count,
    expiredSessions: sessions.count + links.count,
    trialPeople: trials.count,
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
