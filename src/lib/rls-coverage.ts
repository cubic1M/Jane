import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { asUserTransaction, RLS_ROLE } from "@/lib/rls";

// Whether row-level security (docs/security/rls.md) is really on, read from the database's own
// catalog: every user-owned table, with RLS on or off and its policies. /admin/health shows it and
// the daily health check (src/lib/health.ts) emails the team when it drops, so it can be checked
// on the live site without anyone connecting to the database.

export type TableCoverage = {
  table: string;
  rls: boolean;
  policies: number;
  // The per-person policy, without which jane_rls sees nothing of the table (or, with RLS off,
  // everything it was granted).
  personPolicy: boolean;
  ok: boolean;
};

export type RlsCoverage = {
  role: boolean;
  tables: TableCoverage[];
  missing: string[];
  ok: boolean;
};

// The system's own records: deliberately not readable by jane_rls at all, so no policy.
const RECORDS = ["audit_log", "analytics_events"];

type Row = { table: string; rls: boolean; policies: number; person_policy: boolean };

export async function rlsCoverage({
  client = defaultClient,
}: { client?: Pick<PrismaClient, "$queryRaw"> } = {}): Promise<RlsCoverage> {
  // One after another: this also runs inside a transaction (tests), which takes one at a time.
  const roles = await client.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ${RLS_ROLE}`;
  // Every table with a user_id column, whatever the plan says.
  const owned = await client.$queryRaw<{ table: string }[]>`
    SELECT c.relname AS table FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped
    WHERE c.relkind IN ('r', 'p')`;
  // And the ones owned through a parent (gifts, users, households), from the migration's plan,
  // when the database has it.
  const [{ planned }] = await client.$queryRaw<{ planned: boolean }[]>`
    SELECT to_regprocedure('jane_rls_plan()') IS NOT NULL AS planned`;
  const plan = planned
    ? await client.$queryRaw<{ table: string }[]>`
        SELECT table_name AS table FROM jane_rls_plan() WHERE visible IS NOT NULL`
    : [];
  const names = [...new Set([...owned, ...plan].map((t) => t.table))]
    .filter((t) => !RECORDS.includes(t))
    .sort();
  const rows = await client.$queryRaw<Row[]>`
    SELECT c.relname AS table, c.relrowsecurity AS rls, count(p.polname)::int AS policies,
      coalesce(bool_or(p.polname = 'jane_rls_owner'), false) AS person_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    LEFT JOIN pg_policy p ON p.polrelid = c.oid
    WHERE c.relname = ANY(${names})
    GROUP BY c.relname, c.relrowsecurity`;
  const byName = new Map(rows.map((r) => [r.table, r]));
  const tables = names.map((table) => {
    const row = byName.get(table);
    const rls = row?.rls ?? false;
    const personPolicy = row?.person_policy ?? false;
    return { table, rls, policies: row?.policies ?? 0, personPolicy, ok: rls && personPolicy };
  });
  const role = roles[0]?.n > 0;
  const missing = tables.filter((t) => !t.ok).map((t) => t.table);
  return { role, tables, missing, ok: role && missing.length === 0 && tables.length > 0 };
}

// Whether this server really switches to jane_rls for a person's queries, tried live: the same
// switch every scoped query makes, then asking the database who it is.
export async function rlsSwitchWorks(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean> {
  const [who] = await asUserTransaction(
    client,
    userId,
    (tx) => tx.$queryRaw<{ role: string }[]>`SELECT current_user AS role`,
  );
  return who?.role === RLS_ROLE;
}
