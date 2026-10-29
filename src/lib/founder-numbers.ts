import { FOUNDER_NUMBERS } from "@/config/founder-numbers";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  betaPeople,
  computeBetaMetrics,
  loadBetaRows,
  type BetaPeople,
  type DatedBetaRows,
} from "@/lib/beta-metrics";
import { DAY_MS } from "@/lib/dates";
import { db as defaultClient } from "@/lib/db";
import { median } from "@/lib/metrics";
import { formatWholeDollars } from "@/lib/money";
import { FINDING_OUTCOME_PREFIX } from "@/lib/outcomes";

// The founders' beta numbers on /admin/numbers, the ones they quote in applications. The same
// real people as /admin/metrics' closed beta block (src/lib/beta-metrics.ts): no trial people,
// no team or founders' own accounts, no demo-bank-only accounts, with how many were left out.
// Each number is worked out as of each of the last few days from the rows' dates, so the trend
// is the same rule run on less data. computeFounderNumbers is pure; the beta is small, so
// loadFounderNumbers reads the rows.

export type FounderRows = DatedBetaRows & {
  // When real people used Jane: one row per person per hour with anything on the activity log.
  activity: { userId: string; at: Date }[];
  // Trial people right now: left out in the query, so counted apart.
  trialPeople: number;
};

export type Snapshot = {
  signedUp: number;
  // Uploaded a file or connected a bank (not the demo bank).
  added: number;
  withFinding: number;
  // Yearly savings found per person who added an account.
  foundMedianCents: number | null;
  foundMeanCents: number | null;
  // Marked done: a do-it-yourself card or suggestion, or a finding we finished.
  fixesDone: number;
  verified: { people: number; cents: number };
  weeklyActive: number;
  // From sign-up to the first finding, per person who has one.
  medianMsToFirstFinding: number | null;
};

export type FounderNumbers = {
  asOf: Date;
  now: Snapshot;
  // One snapshot per day, oldest first: trendDays ago, …, today (the last one is `now`).
  trend: Snapshot[];
  excluded: BetaPeople["excluded"];
  copyLine: string;
};

const VERIFIED = ["confirmed", "partial"];

// The rows as they stood at `at`: only what existed by then, done and verified only if by then.
export function rowsAt(rows: FounderRows, at: Date): FounderRows {
  const by = (d: Date | null) => d !== null && d <= at;
  return {
    ...rows,
    users: rows.users.filter((u) => by(u.createdAt)),
    accounts: rows.accounts.filter((a) => by(a.createdAt)),
    findings: rows.findings.filter((f) => by(f.createdAt)),
    decisions: rows.decisions.filter((d) => by(d.createdAt)),
    outcomes: rows.outcomes
      .filter((o) => by(o.createdAt))
      .map((o) => ({
        ...o,
        doneAt: by(o.doneAt) ? o.doneAt : null,
        // Verified later: on that day it was still waiting for the transactions.
        status:
          VERIFIED.includes(o.status) && o.verifiedAt && o.verifiedAt > at ? "open" : o.status,
      })),
    activity: rows.activity.filter((a) => a.at <= at),
  };
}

export function snapshot(all: FounderRows, at: Date): Snapshot {
  const rows = rowsAt(all, at);
  const beta = computeBetaMetrics(rows);
  const { real } = betaPeople(rows);

  const outcomes = rows.outcomes.filter((o) => real.has(o.userId));
  const recorded = new Set(outcomes.map((o) => o.suggestionKey));
  // A finding done before the record existed, or one the team finished, has no outcome row.
  const doneFindings = rows.findings.filter(
    (f) =>
      real.has(f.userId) &&
      f.status === "done" &&
      f.updatedAt <= at &&
      !recorded.has(`${FINDING_OUTCOME_PREFIX}${f.id}`),
  );

  const activeSince = at.getTime() - FOUNDER_NUMBERS.activeDays * DAY_MS;
  const firstFinding = new Map<string, number>();
  for (const f of rows.findings) {
    if (!real.has(f.userId)) continue;
    const t = f.createdAt.getTime();
    firstFinding.set(f.userId, Math.min(t, firstFinding.get(f.userId) ?? t));
  }
  const toFirst = rows.users
    .filter((u) => firstFinding.has(u.id))
    .map((u) => Math.max(0, firstFinding.get(u.id)! - u.createdAt.getTime()));

  return {
    signedUp: beta.signedUp,
    added: beta.found.users,
    withFinding: beta.withFinding,
    foundMedianCents: beta.found.medianCents,
    foundMeanCents:
      beta.found.users > 0 ? Math.round(beta.found.totalCents / beta.found.users) : null,
    fixesDone: outcomes.filter((o) => o.doneAt !== null).length + doneFindings.length,
    verified: { people: beta.verified.users, cents: beta.verified.cents },
    weeklyActive: new Set(
      rows.activity
        .filter((a) => real.has(a.userId) && a.at.getTime() > activeSince)
        .map((a) => a.userId),
    ).size,
    medianMsToFirstFinding: median(toFirst),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The line to paste into an application, from the same numbers as the page.
export function copyLine(s: Snapshot): string {
  const parts = [plural(s.signedUp, "beta user", "beta users")];
  if (s.foundMedianCents !== null) {
    parts.push(`${formatWholeDollars(s.foundMedianCents)}/yr found per person`);
  }
  parts.push(`${plural(s.fixesDone, "fix", "fixes")} made`);
  if (s.verified.cents > 0) parts.push(`${formatWholeDollars(s.verified.cents)} verified saved`);
  return parts.join(" · ");
}

export function computeFounderNumbers(rows: FounderRows, now: Date): FounderNumbers {
  const trend = Array.from({ length: FOUNDER_NUMBERS.trendDays + 1 }, (_, i) =>
    snapshot(rows, new Date(now.getTime() - (FOUNDER_NUMBERS.trendDays - i) * DAY_MS)),
  );
  const current = trend[trend.length - 1];
  const { excluded } = betaPeople(rows);
  return {
    asOf: now,
    now: current,
    trend,
    excluded: { ...excluded, trial: excluded.trial + rows.trialPeople },
    copyLine: copyLine(current),
  };
}

type Options = { client?: PrismaClient; now?: Date };

export async function loadFounderRows({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<FounderRows> {
  const since = new Date(
    now.getTime() - (FOUNDER_NUMBERS.trendDays + FOUNDER_NUMBERS.activeDays) * DAY_MS,
  );
  const [rows, activity, trialPeople] = await Promise.all([
    loadBetaRows({ client }),
    // The activity log has a row per click, so it's read once per person per hour.
    client.$queryRaw<{ user_id: string; at: Date }[]>`
      SELECT DISTINCT user_id, date_trunc('hour', created_at) AS at
      FROM activity_events
      WHERE user_id IS NOT NULL
        AND NOT starts_with(user_id, ${TRIAL_ID_PREFIX})
        AND created_at >= ${since}`,
    client.user.count({ where: { id: { startsWith: TRIAL_ID_PREFIX } } }),
  ]);
  return {
    ...rows,
    activity: activity.map((a) => ({ userId: a.user_id, at: new Date(a.at) })),
    trialPeople,
  };
}

export async function loadFounderNumbers(options: Options = {}): Promise<FounderNumbers> {
  const now = options.now ?? new Date();
  return computeFounderNumbers(await loadFounderRows({ ...options, now }), now);
}
