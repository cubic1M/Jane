import { sumMoneyFound } from "@/detection/engine";
import type {
  ActionStatus,
  ActionType,
  Confidence,
  DecisionChoice,
  FindingStatus,
  FindingType,
  PrismaClient,
} from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import type { Admin } from "@/lib/concierge";
import { db as defaultClient } from "@/lib/db";
import { TRIAL_ID_PREFIX } from "@/config/trial";

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
  decisions: { findingType: FindingType; choice: DecisionChoice; at: Date }[];
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
  // Referral revenue the team recorded.
  conversions: { partner: string; amountCents: number; at: Date }[];
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

  // Approval rate per finding type: yes answers (ours or do-it-yourself) over cards opened.
  const opens = rows.cardOpens.filter((o) => within(o.at, w));
  const yeses = rows.decisions.filter((d) => d.choice !== "no" && within(d.at, w));
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
    referrals: referralRevenue(rows.conversions, w),
  };
}

// Referral revenue recorded in the window, in total and by partner (largest first).
export function referralRevenue(conversions: MetricRows["conversions"], w: Window) {
  const inWindow = conversions.filter((c) => within(c.at, w));
  const byPartner = new Map<string, { conversions: number; cents: number }>();
  for (const c of inWindow) {
    const total = byPartner.get(c.partner) ?? { conversions: 0, cents: 0 };
    byPartner.set(c.partner, {
      conversions: total.conversions + 1,
      cents: total.cents + c.amountCents,
    });
  }
  return {
    conversions: inWindow.length,
    cents: inWindow.reduce((sum, c) => sum + c.amountCents, 0),
    byPartner: [...byPartner]
      .map(([partner, t]) => ({ partner, ...t }))
      .sort((a, b) => b.cents - a.cents || a.partner.localeCompare(b.partner)),
  };
}

export type Metrics = ReturnType<typeof computeMetrics>;

export type AutomateRow = {
  type: ActionType;
  // Every action of this type ever approved.
  approvals: number;
  // Average logged minutes over finished actions; null until one has minutes.
  averageMinutes: number | null;
  // approvals × averageMinutes: the team time this type has cost so far.
  teamMinutes: number | null;
};

// "Automate next": action types ranked by approvals × minutes per action, all time.
// Types without logged minutes go last, by approvals.
export function automateNext(actions: MetricRows["actions"]): AutomateRow[] {
  return byType(actions.map((a) => a.type))
    .map((type) => {
      const ofType = actions.filter((a) => a.type === type);
      const logged = ofType.filter((a) => a.status === "done" && a.minutesSpent !== null);
      const averageMinutes = logged.length
        ? logged.reduce((sum, a) => sum + (a.minutesSpent ?? 0), 0) / logged.length
        : null;
      return {
        type,
        approvals: ofType.length,
        averageMinutes: averageMinutes === null ? null : Math.round(averageMinutes),
        teamMinutes: averageMinutes === null ? null : Math.round(ofType.length * averageMinutes),
      };
    })
    .sort(
      (a, b) =>
        (b.teamMinutes ?? -1) - (a.teamMinutes ?? -1) ||
        b.approvals - a.approvals ||
        a.type.localeCompare(b.type),
    );
}

// Reads every row the metrics need: the reference data for computeMetrics in tests. The
// page uses metrics-sql.ts instead.
// Spec step 138: people trying Jane with sample data are never counted.
const REAL = { not: { startsWith: TRIAL_ID_PREFIX } };

export async function loadMetricRows({
  client = defaultClient,
}: { client?: PrismaClient } = {}): Promise<MetricRows> {
  const [
    users,
    accounts,
    findings,
    opens,
    decisions,
    actions,
    intents,
    events,
    digests,
    conversions,
  ] = await Promise.all([
    client.user.findMany({ where: { id: REAL }, select: { id: true, createdAt: true } }),
    client.account.groupBy({ by: ["userId"], where: { userId: REAL }, _min: { createdAt: true } }),
    client.finding.findMany({
      where: { userId: REAL },
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
      where: { undoneAt: null, userId: REAL },
      select: { choice: true, createdAt: true, finding: { select: { type: true } } },
    }),
    client.action.findMany({
      where: { userId: REAL },
      select: {
        userId: true,
        type: true,
        status: true,
        createdAt: true,
        completedAt: true,
        minutesSpent: true,
      },
    }),
    client.membershipIntent.findMany({
      where: { userId: REAL },
      select: { userId: true, createdAt: true },
    }),
    client.analyticsEvent.findMany({
      where: { userId: { not: null } },
      select: { userId: true, createdAt: true },
    }),
    client.digest.findMany({
      where: { openedAt: { not: null }, userId: REAL },
      select: { userId: true, openedAt: true },
    }),
    client.referralConversion.findMany({
      select: { amountCents: true, createdAt: true, partner: { select: { name: true } } },
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
    conversions: conversions.map((c) => ({
      partner: c.partner.name,
      amountCents: c.amountCents,
      at: c.createdAt,
    })),
  };
}

// The metrics page: worked out by Postgres (metrics-sql.ts), which matches computeMetrics
// on the same data but doesn't load every row.
export async function loadMetrics(
  admin: Admin,
  days: number[],
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<{ windows: { days: number; metrics: Metrics }[]; automateNext: AutomateRow[] }> {
  await logAudit({ type: "admin", id: admin.id }, "admin_viewed_metrics", null, {
    windows: days.join(","),
  });
  // Imported here because metrics-sql.ts imports this file.
  const { automateNextSql, computeMetricsSql } = await import("./metrics-sql");
  const windows = [];
  for (const d of days) {
    windows.push({
      days: d,
      metrics: await computeMetricsSql(client, {
        start: new Date(now.getTime() - d * DAY_MS),
        end: now,
      }),
    });
  }
  return { windows, automateNext: await automateNextSql(client) };
}
