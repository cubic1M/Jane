import { TRIAL_ID_PREFIX } from "@/config/trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { betaPeople, computeBetaMetrics, loadBetaRows } from "@/lib/beta-metrics";
import { db as defaultClient } from "@/lib/db";
import { monthlyCapCents, monthlySpentCents } from "@/lib/jane-agent/claude-limits";
import { isDemoItemId } from "@/lib/plaid/demo-ids";
import { ITEM_STATUS } from "@/lib/plaid/sync";
import { systemDb } from "@/lib/system-db";
import { monthStartUtc } from "@/lib/dates";

const WHY = "Founder costs count across people: numbers only";

// What the closed beta costs this month, on /admin/costs: Plaid's connected banks (pay as you go
// bills each connected Item for every month it's connected, so one removed this month still
// counts), Claude's spend against the month's cap, and how many real beta people there are. Counts
// only: no names, no institutions, nothing from anyone's bank. Trial people, the team and people
// on the demo bank alone are left out, as on /admin/metrics.

export type BetaCosts = {
  // "2026-11", UTC.
  month: string;
  plaid: {
    // Real banks connected now, and of those how many need a sign-in.
    connected: number;
    needSignIn: number;
    // Of the connected: linked this month, and with the optional products (billed on their own).
    linkedThisMonth: number;
    withLiabilities: number;
    withInvestments: number;
    // Real banks removed this month: Plaid bills them for the month too.
    removedThisMonth: number;
    // What this month's Transactions bill counts, at most.
    billedThisMonth: number;
  };
  claude: { spentCents: number; capCents: number; share: number };
  people: { signedUp: number; activeThisMonth: number; activeThisWeek: number; invited: number };
};

export async function betaCosts({
  client = defaultClient,
  now = new Date(),
  userIds,
}: {
  client?: PrismaClient;
  now?: Date;
  // Tests only: count only these people (the test database is shared).
  userIds?: readonly string[];
} = {}): Promise<BetaCosts> {
  const mine = (id: unknown) => !userIds || (typeof id === "string" && userIds.includes(id));
  const start = monthStartUtc(now);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [items, removed, spentCents, rows, active] = await Promise.all([
    systemDb(WHY, client).plaidItem.findMany({
      where: { userId: { not: { startsWith: TRIAL_ID_PREFIX } } },
      select: {
        userId: true,
        plaidItemId: true,
        status: true,
        liabilities: true,
        investments: true,
        createdAt: true,
      },
    }),
    systemDb(WHY, client).auditLog.findMany({
      where: { event: "item_removed", createdAt: { gte: start, lt: now } },
      select: { metadata: true },
    }),
    monthlySpentCents({ client, now }),
    loadBetaRows({ client }),
    // One row per person and day is enough to say who came back.
    systemDb(WHY, client).$queryRaw<{ user_id: string; day: Date }[]>`
      SELECT DISTINCT user_id, date_trunc('day', created_at) AS day
      FROM activity_events
      WHERE user_id IS NOT NULL
        AND NOT starts_with(user_id, ${TRIAL_ID_PREFIX})
        AND created_at >= ${start} AND created_at < ${now}`,
  ]);
  const real = items.filter((i) => mine(i.userId) && !isDemoItemId(i.plaidItemId));
  const removedThisMonth = removed.filter((r) => {
    const meta = r.metadata as { demo?: unknown; user_id?: unknown };
    return (
      mine(meta.user_id) &&
      meta.demo !== true &&
      !(typeof meta.user_id === "string" && meta.user_id.startsWith(TRIAL_ID_PREFIX))
    );
  }).length;
  const capCents = monthlyCapCents();
  const scoped = userIds
    ? {
        ...rows,
        users: rows.users.filter((u) => mine(u.id)),
        invited: rows.invited.filter((i) =>
          rows.users.some((u) => mine(u.id) && u.email === i.email),
        ),
      }
    : rows;
  const { real: people } = betaPeople(scoped);
  const activeSince = (since: Date) =>
    new Set(
      active.filter((a) => people.has(a.user_id) && new Date(a.day) >= since).map((a) => a.user_id),
    ).size;
  return {
    month: start.toISOString().slice(0, 7),
    plaid: {
      connected: real.length,
      needSignIn: real.filter((i) => i.status === ITEM_STATUS.loginRequired).length,
      linkedThisMonth: real.filter((i) => i.createdAt >= start).length,
      withLiabilities: real.filter((i) => i.liabilities).length,
      withInvestments: real.filter((i) => i.investments).length,
      removedThisMonth,
      billedThisMonth: real.length + removedThisMonth,
    },
    claude: { spentCents, capCents, share: capCents > 0 ? spentCents / capCents : 0 },
    people: {
      signedUp: people.size,
      activeThisMonth: activeSince(start),
      // A week back from the start of today, so it's whole days like the rows.
      activeThisWeek: activeSince(
        new Date(Date.UTC(weekAgo.getUTCFullYear(), weekAgo.getUTCMonth(), weekAgo.getUTCDate())),
      ),
      invited: computeBetaMetrics(scoped).invited,
    },
  };
}
