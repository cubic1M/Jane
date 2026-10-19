import { COUNT_ONLY_WHEN_APPROVED, MONEY_FOUND_MIN_CONFIDENCE } from "@/config/detection";
import { atLeast } from "@/detection/helpers";
import {
  Prisma,
  type ActionType,
  type FindingType,
  type PrismaClient,
} from "@/generated/prisma/client";
import { median, referralRevenue, type AutomateRow, type Metrics, type Window } from "./metrics";

// The same metrics as computeMetrics (src/lib/metrics.ts), worked out by Postgres so the
// team's page doesn't load every row as people join. computeMetrics stays the readable
// definition; metrics-sql.integration.test.ts checks the two agree on the same data.

type Client = Pick<PrismaClient, "$queryRaw">;

const DAY_SECONDS = 24 * 60 * 60;
// 30-day retention: did a linked user come back in days 23 to 30 after linking?
const RETENTION_FROM = Prisma.sql`make_interval(secs => ${23 * DAY_SECONDS})`;
const RETENTION_TO = Prisma.sql`make_interval(secs => ${30 * DAY_SECONDS})`;

const OPEN = ["new", "shown", "approved", "in_progress"];
const APPROVED = ["approved", "in_progress"];
const CONFIDENT = (["low", "medium", "high"] as const).filter((c) =>
  atLeast(c, MONEY_FOUND_MIN_CONFIDENCE),
);

const list = (values: readonly string[]) => Prisma.join(values.map((v) => Prisma.sql`${v}`));
const n = (value: bigint | number | null) => Number(value ?? 0);
const rate = (part: number, whole: number) => (whole === 0 ? null : part / whole);

// Each person's first linked or imported account.
const FIRST_LINK = Prisma.sql`
  first_link AS (
    SELECT user_id, MIN(created_at) AS linked_at FROM accounts GROUP BY user_id
  )`;

export async function computeMetricsSql(client: Client, w: Window): Promise<Metrics> {
  const { start, end } = w;
  const inWindow = (column: Prisma.Sql) => Prisma.sql`${column} >= ${start} AND ${column} < ${end}`;

  const [linkRate] = await client.$queryRaw<{ signed_up: bigint; linked: bigint }[]>`
    WITH ${FIRST_LINK}
    SELECT COUNT(*) AS signed_up, COUNT(fl.user_id) AS linked
    FROM users u LEFT JOIN first_link fl ON fl.user_id = u.id
    WHERE ${inWindow(Prisma.sql`u.created_at`)}`;

  // Money found per user who linked in the window, by sumMoneyFound's rules.
  const found = await client.$queryRaw<{ cents: bigint }[]>`
    WITH ${FIRST_LINK}
    SELECT COALESCE(SUM(f.annual_savings_cents) FILTER (
      WHERE f.annual_savings_cents IS NOT NULL
        AND f.status::text IN (${list(OPEN)})
        AND f.confidence::text IN (${list(CONFIDENT)})
        AND (f.type::text NOT IN (${list(COUNT_ONLY_WHEN_APPROVED)})
             OR f.status::text IN (${list(APPROVED)}))
    ), 0) AS cents
    FROM first_link fl LEFT JOIN findings f ON f.user_id = fl.user_id
    WHERE ${inWindow(Prisma.sql`fl.linked_at`)}
    GROUP BY fl.user_id`;

  const opens = await client.$queryRaw<{ type: FindingType; count: bigint }[]>`
    SELECT f.type::text AS type, COUNT(*) AS count
    FROM analytics_events e JOIN findings f ON f.id = e.properties->>'finding_id'
    WHERE e.name = 'card_opened' AND ${inWindow(Prisma.sql`e.created_at`)}
    GROUP BY f.type`;
  const yeses = await client.$queryRaw<{ type: FindingType; count: bigint }[]>`
    SELECT f.type::text AS type, COUNT(*) AS count
    FROM decisions d JOIN findings f ON f.id = d.finding_id
    WHERE d.undone_at IS NULL AND d.choice::text <> 'no' AND ${inWindow(Prisma.sql`d.created_at`)}
    GROUP BY f.type`;
  const shownBy = new Map(opens.map((o) => [o.type, n(o.count)]));
  const approvedBy = new Map(yeses.map((y) => [y.type, n(y.count)]));
  const approval = [...new Set([...shownBy.keys(), ...approvedBy.keys()])].sort().map((type) => {
    const shown = shownBy.get(type) ?? 0;
    const approved = approvedBy.get(type) ?? 0;
    return { type, shown, approved, rate: rate(approved, shown) };
  });

  const [completion] = await client.$queryRaw<{ closed: bigint; done: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE status::text IN ('done', 'failed')) AS closed,
           COUNT(*) FILTER (WHERE status::text = 'done') AS done
    FROM actions WHERE completed_at IS NOT NULL AND ${inWindow(Prisma.sql`completed_at`)}`;

  const [willingness] = await client.$queryRaw<{ completed: bigint; willing: bigint }[]>`
    WITH first_done AS (
      SELECT user_id, MIN(completed_at) AS done_at FROM actions
      WHERE status::text = 'done' AND completed_at IS NOT NULL GROUP BY user_id
    )
    SELECT COUNT(*) AS completed,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM membership_intents m
             WHERE m.user_id = fd.user_id AND m.created_at >= fd.done_at
           )) AS willing
    FROM first_done fd WHERE ${inWindow(Prisma.sql`fd.done_at`)}`;

  const [retention] = await client.$queryRaw<{ cohort: bigint; retained: bigint }[]>`
    WITH ${FIRST_LINK},
    activity AS (
      SELECT user_id, created_at AS at FROM analytics_events WHERE user_id IS NOT NULL
      UNION ALL
      SELECT user_id, opened_at AS at FROM digests WHERE opened_at IS NOT NULL
    ),
    cohort AS (
      SELECT user_id, linked_at FROM first_link
      WHERE ${inWindow(Prisma.sql`linked_at + ${RETENTION_TO}`)}
    )
    SELECT COUNT(*) AS cohort,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM activity a WHERE a.user_id = c.user_id
               AND a.at >= c.linked_at + ${RETENTION_FROM}
               AND a.at <= c.linked_at + ${RETENTION_TO}
           )) AS retained
    FROM cohort c`;

  const minuteRows = await client.$queryRaw<
    { type: ActionType; logged: bigint; total: bigint | null }[]
  >`
    SELECT type::text AS type,
           COUNT(minutes_spent) AS logged,
           SUM(minutes_spent) AS total
    FROM actions
    WHERE status::text = 'done' AND completed_at IS NOT NULL
      AND ${inWindow(Prisma.sql`completed_at`)}
    GROUP BY type ORDER BY type::text`;

  const conversions = await client.$queryRaw<{ partner: string; amount_cents: number; at: Date }[]>`
    SELECT p.name AS partner, c.amount_cents, c.created_at AS at
    FROM referral_conversions c JOIN referral_partners p ON p.id = c.partner_id
    WHERE ${inWindow(Prisma.sql`c.created_at`)}`;

  const cents = found.map((f) => n(f.cents));
  return {
    linkRate: {
      signedUp: n(linkRate.signed_up),
      linked: n(linkRate.linked),
      rate: rate(n(linkRate.linked), n(linkRate.signed_up)),
    },
    moneyFound: { users: cents.length, medianCents: median(cents) },
    approval,
    completion: {
      closed: n(completion.closed),
      done: n(completion.done),
      rate: rate(n(completion.done), n(completion.closed)),
    },
    willingnessToPay: {
      completed: n(willingness.completed),
      willing: n(willingness.willing),
      rate: rate(n(willingness.willing), n(willingness.completed)),
    },
    retention: {
      cohort: n(retention.cohort),
      retained: n(retention.retained),
      rate: rate(n(retention.retained), n(retention.cohort)),
    },
    minutes: minuteRows.map((m) => ({
      type: m.type,
      actions: n(m.logged),
      averageMinutes: n(m.logged) ? Math.round(n(m.total) / n(m.logged)) : null,
    })),
    referrals: referralRevenue(
      conversions.map((c) => ({ partner: c.partner, amountCents: c.amount_cents, at: c.at })),
      w,
    ),
  };
}

// "Automate next" (automateNext in metrics.ts), all time.
export async function automateNextSql(client: Client): Promise<AutomateRow[]> {
  const rows = await client.$queryRaw<
    { type: ActionType; approvals: bigint; logged: bigint; total: bigint | null }[]
  >`
    SELECT type::text AS type,
           COUNT(*) AS approvals,
           COUNT(minutes_spent) FILTER (WHERE status::text = 'done') AS logged,
           SUM(minutes_spent) FILTER (WHERE status::text = 'done') AS total
    FROM actions GROUP BY type`;
  return rows
    .map((r) => {
      const average = n(r.logged) ? n(r.total) / n(r.logged) : null;
      return {
        type: r.type,
        approvals: n(r.approvals),
        averageMinutes: average === null ? null : Math.round(average),
        teamMinutes: average === null ? null : Math.round(n(r.approvals) * average),
      };
    })
    .sort(
      (a, b) =>
        (b.teamMinutes ?? -1) - (a.teamMinutes ?? -1) ||
        b.approvals - a.approvals ||
        a.type.localeCompare(b.type),
    );
}
