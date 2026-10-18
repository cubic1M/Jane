import { sumMoneyFound } from "@/detection/engine";
import type {
  ActionStatus,
  ActionType,
  Confidence,
  FindingStatus,
  FindingType,
  PrismaClient,
} from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import type { Admin } from "@/lib/concierge";
import { db as defaultClient } from "@/lib/db";

// The spec's success metrics, for /admin/metrics. computeMetrics is pure (rows in,
// numbers out) so each definition is tested; loadMetrics reads the rows.

const DAY_MS = 24 * 60 * 60 * 1000;
// 30-day retention: did a linked user come back in days 23 to 30 after linking?
const RETENTION_FROM_DAY = 23;
const RETENTION_TO_DAY = 30;

export type MetricRows = {
  users: { id: string; createdAt: Date }[];
  // When each user first linked or imported an account.
  links: { userId: string; linkedAt: Date }[];
  findings: {
    userId: string;
    type: FindingType;
    status: FindingStatus;
    confidence: Confidence;
    annualSavingsCents: number | null;
  }[];
  cardOpens: { findingType: FindingType; at: Date }[];
  decisions: { findingType: FindingType; choice: "yes" | "no"; at: Date }[];
  actions: {
    userId: string;
    type: ActionType;
    status: ActionStatus;
    createdAt: Date;
    completedAt: Date | null;
    minutesSpent: number | null;
  }[];
  membershipIntents: { userId: string; at: Date }[];
  // Anything showing the person came back: an app event or a digest click.
  activity: { userId: string; at: Date }[];
};

export type Window = { start: Date; end: Date };

const within = (at: Date, w: Window) => at >= w.start && at < w.end;
const rate = (part: number, whole: number) => (whole === 0 ? null : part / whole);

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function byType<T extends string>(types: T[]) {
  return [...new Set(types)].sort();
}

export function computeMetrics(rows: MetricRows, w: Window) {
  const firstLink = new Map<string, Date>();
  for (const { userId, linkedAt } of rows.links) {
    const known = firstLink.get(userId);
    if (!known || linkedAt < known) firstLink.set(userId, linkedAt);
  }

  // Link rate: of the people who signed up in the window, how many linked an account.
  const signedUp = rows.users.filter((u) => within(u.createdAt, w));
  const linked = signedUp.filter((u) => firstLink.has(u.id));

  // Money found: median yearly savings per user who linked in the window.
  const linkedInWindow = [...firstLink].filter(([, at]) => within(at, w)).map(([id]) => id);
  const moneyFound = median(
    linkedInWindow.map((id) => sumMoneyFound(rows.findings.filter((f) => f.userId === id))),
  );

  // Approval rate per finding type: yes answers over cards opened.
  const opens = rows.cardOpens.filter((o) => within(o.at, w));
  const yeses = rows.decisions.filter((d) => d.choice === "yes" && within(d.at, w));
  const approval = byType([...opens, ...yeses].map((r) => r.findingType)).map((type) => {
    const shown = opens.filter((o) => o.findingType === type).length;
    const approved = yeses.filter((d) => d.findingType === type).length;
    return { type, shown, approved, rate: rate(approved, shown) };
  });

  // Completion rate: of the actions the team closed in the window, how many succeeded.
  const closed = rows.actions.filter(
    (a) =>
      a.completedAt && within(a.completedAt, w) && (a.status === "done" || a.status === "failed"),
  );
  const done = closed.filter((a) => a.status === "done");

  // Willingness to pay: people whose first action finished in the window, and how many
  // reserved or paid for membership afterwards.
  const firstDone = new Map<string, Date>();
  for (const a of rows.actions) {
    if (a.status !== "done" || !a.completedAt) continue;
    const known = firstDone.get(a.userId);
    if (!known || a.completedAt < known) firstDone.set(a.userId, a.completedAt);
  }
  const completedUsers = [...firstDone].filter(([, at]) => within(at, w));
  const willing = completedUsers.filter(([id, at]) =>
    rows.membershipIntents.some((m) => m.userId === id && m.at >= at),
  );

  // 30-day retention: people whose 30th day after linking fell in the window, and how
  // many came back in days 23 to 30.
  const cohort = [...firstLink].filter(([, at]) =>
    within(new Date(at.getTime() + RETENTION_TO_DAY * DAY_MS), w),
  );
  const retained = cohort.filter(([id, at]) => {
    const from = at.getTime() + RETENTION_FROM_DAY * DAY_MS;
    const to = at.getTime() + RETENTION_TO_DAY * DAY_MS;
    return rows.activity.some(
      (e) => e.userId === id && e.at.getTime() >= from && e.at.getTime() <= to,
    );
  });

  // Minutes per finished action, per type: what to automate first.
  const minutes = byType(done.map((a) => a.type)).map((type) => {
    const logged = done.filter((a) => a.type === type && a.minutesSpent !== null);
    const total = logged.reduce((sum, a) => sum + (a.minutesSpent ?? 0), 0);
    return {
      type,
      actions: logged.length,
      averageMinutes: logged.length ? Math.round(total / logged.length) : null,
    };
  });

  return {
    linkRate: {
      signedUp: signedUp.length,
      linked: linked.length,
      rate: rate(linked.length, signedUp.length),
    },
    moneyFound: { users: linkedInWindow.length, medianCents: moneyFound },
    approval,
    completion: {
      closed: closed.length,
      done: done.length,
      rate: rate(done.length, closed.length),
    },
    willingnessToPay: {
      completed: completedUsers.length,
      willing: willing.length,
      rate: rate(willing.length, completedUsers.length),
    },
    retention: {
      cohort: cohort.length,
      retained: retained.length,
      rate: rate(retained.length, cohort.length),
    },
    minutes,
  };
}

export type Metrics = ReturnType<typeof computeMetrics>;

// Reads everything the metrics need. Fine at beta scale; move to SQL aggregates later.
export async function loadMetricRows({
  client = defaultClient,
}: { client?: PrismaClient } = {}): Promise<MetricRows> {
  const [users, accounts, findings, opens, decisions, actions, intents, events, digests] =
    await Promise.all([
      client.user.findMany({ select: { id: true, createdAt: true } }),
      client.account.groupBy({ by: ["userId"], _min: { createdAt: true } }),
      client.finding.findMany({
        select: {
          id: true,
          userId: true,
          type: true,
          status: true,
          confidence: true,
          annualSavingsCents: true,
        },
      }),
      client.analyticsEvent.findMany({
        where: { name: "card_opened" },
        select: { properties: true, createdAt: true },
      }),
      client.decision.findMany({
        where: { undoneAt: null },
        select: { choice: true, createdAt: true, finding: { select: { type: true } } },
      }),
      client.action.findMany({
        select: {
          userId: true,
          type: true,
          status: true,
          createdAt: true,
          completedAt: true,
          minutesSpent: true,
        },
      }),
      client.membershipIntent.findMany({ select: { userId: true, createdAt: true } }),
      client.analyticsEvent.findMany({
        where: { userId: { not: null } },
        select: { userId: true, createdAt: true },
      }),
      client.digest.findMany({
        where: { openedAt: { not: null } },
        select: { userId: true, openedAt: true },
      }),
    ]);

  const findingType = new Map(findings.map((f) => [f.id, f.type]));
  return {
    users,
    links: accounts.flatMap((a) =>
      a._min.createdAt ? [{ userId: a.userId, linkedAt: a._min.createdAt }] : [],
    ),
    findings,
    cardOpens: opens.flatMap((o) => {
      const id = (o.properties as { finding_id?: unknown } | null)?.finding_id;
      const type = typeof id === "string" ? findingType.get(id) : undefined;
      return type ? [{ findingType: type, at: o.createdAt }] : [];
    }),
    decisions: decisions.map((d) => ({
      findingType: d.finding.type,
      choice: d.choice,
      at: d.createdAt,
    })),
    actions,
    membershipIntents: intents.map((m) => ({ userId: m.userId, at: m.createdAt })),
    activity: [
      ...events.flatMap((e) => (e.userId ? [{ userId: e.userId, at: e.createdAt }] : [])),
      ...digests.flatMap((d) => (d.openedAt ? [{ userId: d.userId, at: d.openedAt }] : [])),
    ],
  };
}

export async function loadMetrics(
  admin: Admin,
  days: number[],
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<{ days: number; metrics: Metrics }[]> {
  const rows = await loadMetricRows({ client });
  await logAudit({ type: "admin", id: admin.id }, "admin_viewed_metrics", null, {
    windows: days.join(","),
  });
  return days.map((d) => ({
    days: d,
    metrics: computeMetrics(rows, { start: new Date(now.getTime() - d * DAY_MS), end: now }),
  }));
}
