import type { PrismaClient } from "@/generated/prisma/client";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { logAudit } from "@/lib/audit";
import type { Admin } from "@/lib/concierge";
import { db as defaultClient } from "@/lib/db";
import { DAY_MS } from "@/lib/dates";
import { isDemoItemId } from "@/lib/plaid/demo";
import { groupVisits, type Visit } from "./describe";
import { computeFunnel, furthestStep, type FunnelStep } from "./funnel";

// The founder view of the beta's activity log (/admin/activity): who used Jane and when, the
// funnel from sign-up to acting on a card, and one person's visits. Every view is in the audit
// log. Reads across people, so admin pages only.

type Options = { client?: PrismaClient; now?: Date };

// Most events read for one person's timeline, newest first.
const TIMELINE_LIMIT = 2000;

export type BetaUser = { id: string; email: string; createdAt: Date };

// Real beta users: not admins, not trial people, not people whose only bank is the demo bank.
async function betaUsers(
  client: PrismaClient,
): Promise<{ users: BetaUser[]; linked: Set<string> }> {
  const users = await client.user.findMany({
    where: { role: "user", NOT: { id: { startsWith: TRIAL_ID_PREFIX } } },
    select: { id: true, email: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const ids = users.map((u) => u.id);
  const [items, csv] = await Promise.all([
    client.plaidItem.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, plaidItemId: true },
    }),
    client.account.findMany({
      where: { userId: { in: ids }, source: "csv" },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  const linked = new Set(csv.map((a) => a.userId));
  const demo = new Set<string>();
  for (const item of items) (isDemoItemId(item.plaidItemId) ? demo : linked).add(item.userId);
  return { users: users.filter((u) => linked.has(u.id) || !demo.has(u.id)), linked };
}

export type ActivityUserRow = BetaUser & {
  // The furthest funnel step they reached.
  reached: string;
  lastSeen: Date | null;
  visits: number;
  events: number;
};

export type ActivityOverview = {
  people: ActivityUserRow[];
  funnel: FunnelStep[];
  landingViews: number;
};

export async function loadActivityOverview(
  admin: Admin,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ActivityOverview> {
  await logAudit({ type: "admin", id: admin.id }, "admin_viewed_activity", null, { view: "list" });
  const { users, linked } = await betaUsers(client);
  const ids = users.map((u) => u.id);
  const [stats, findings, cardOpens, decisions, landingViews] = await Promise.all([
    client.$queryRaw<
      { user_id: string; last_seen: Date; visits: bigint; events: bigint; last_view: Date | null }[]
    >`
      SELECT user_id, max(created_at) AS last_seen, count(DISTINCT visit_id) AS visits,
             count(*) AS events, max(created_at) FILTER (WHERE kind = 'page_view') AS last_view
      FROM activity_events WHERE user_id = ANY(${ids}) GROUP BY user_id`,
    client.finding.groupBy({
      by: ["userId"],
      where: { userId: { in: ids } },
      _min: { createdAt: true },
    }),
    client.analyticsEvent.findMany({
      where: { userId: { in: ids }, name: "card_opened" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    client.decision.findMany({
      where: { userId: { in: ids } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    client.activityEvent.count({
      where: {
        userId: null,
        kind: "page_view",
        createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
      },
    }),
  ]);
  const byUser = new Map(stats.map((s) => [s.user_id, s]));
  const acted = new Set(decisions.map((d) => d.userId));
  // Saw findings: opened a card, answered one, or opened a page after their first finding.
  const sawFindings = new Set([...cardOpens.map((c) => c.userId!), ...acted]);
  for (const f of findings) {
    const lastView = byUser.get(f.userId)?.last_view;
    if (f._min.createdAt && lastView && lastView >= f._min.createdAt) sawFindings.add(f.userId);
  }
  const input = { users: ids, linked, sawFindings, acted };
  const people = users
    .map((u) => {
      const s = byUser.get(u.id);
      return {
        ...u,
        reached: furthestStep(u.id, input),
        lastSeen: s?.last_seen ?? null,
        visits: Number(s?.visits ?? 0),
        events: Number(s?.events ?? 0),
      };
    })
    .sort((a, b) => (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0));
  return {
    people,
    funnel: computeFunnel(input),
    landingViews,
  };
}

export type ActivityTimeline = {
  person: BetaUser & { timezone: string | null };
  visits: Visit[];
};

// Null for someone who isn't a recorded beta user (or doesn't exist).
export async function loadActivityTimeline(
  admin: Admin,
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<ActivityTimeline | null> {
  const person = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, createdAt: true, timezone: true, role: true },
  });
  if (!person || person.role !== "user" || person.id.startsWith(TRIAL_ID_PREFIX)) return null;
  await logAudit(
    { type: "admin", id: admin.id },
    "admin_viewed_activity",
    { type: "user", id: userId },
    {
      view: "timeline",
    },
  );
  const [activity, funnel] = await Promise.all([
    client.activityEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: TIMELINE_LIMIT,
      select: {
        createdAt: true,
        visitId: true,
        kind: true,
        path: true,
        role: true,
        label: true,
        data: true,
      },
    }),
    client.analyticsEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: TIMELINE_LIMIT,
      select: { createdAt: true, name: true, properties: true },
    }),
  ]);
  return {
    person: {
      id: person.id,
      email: person.email,
      createdAt: person.createdAt,
      timezone: person.timezone,
    },
    visits: groupVisits(
      activity.map(({ createdAt, ...e }) => ({ at: createdAt, ...e })),
      funnel.map(({ createdAt, ...e }) => ({ at: createdAt, ...e })),
    ),
  };
}
