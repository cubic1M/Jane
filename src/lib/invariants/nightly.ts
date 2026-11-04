import {
  CARD_PAYMENT_MATCH_DAYS,
  CARD_PAYMENT_SETTLE_DAYS,
  INVARIANT_WINDOW_DAYS,
} from "@/config/invariants";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { systemDb, type SystemDb } from "@/lib/system-db";

// What must hold on live data, checked every night with no labels: the money adds up, whatever a
// person's statements look like. Counts only. No description, merchant, amount, date or person
// leaves these queries; what they return is kept in cron_runs and is safe in a log. Sample people
// are left out, as everywhere that counts people. docs/money-rules.md.

const WHY = "The nightly invariants count rows across everyone and read no row";

const TRIAL = `${TRIAL_ID_PREFIX.replace("_", "\\_")}%`;
const WANTS_AN_ANSWER = ["new", "shown"];
const OPEN = ["new", "shown", "approved", "in_progress"];
const list = (values: readonly string[]) => Prisma.join(values.map((v) => Prisma.sql`${v}`));
const person = (column: string) => Prisma.sql`${Prisma.raw(column)} NOT LIKE ${TRIAL}`;

type Counted = { n: number };

export type InvariantSummary = {
  people: number;
  findings: {
    open: number;
    // Must be 0, or the night's run alerts the team.
    negativeSaving: number;
    questionWithDollars: number;
    feeTotalOffItsRows: number;
    // Rows a finding rests on that are gone or changed: to look at. A scan puts these right, so one
    // in the hours before it isn't a fault.
    subscriptionSavingOffItsCost: number;
    restsOnMissingRows: number;
  };
  imports: { recent: number; withControlWarnings: number };
  categories: { rows: number; uncategorized: number; byClaude: number; correctedByPerson: number };
  cardPayments: { legs: number; unmatched: number };
  // Each NOT VALID money rule's old rows: at 0 a later migration can VALIDATE it.
  constraints: { unvalidated: number; rulesWithOldRows: number; oldRows: Record<string, number> };
  // The names of what must be 0 and isn't.
  broken: string[];
};

async function one(db: SystemDb, query: Prisma.Sql): Promise<number> {
  const [row] = await db.$queryRaw<Counted[]>(query);
  return row?.n ?? 0;
}

async function findingCounts(db: SystemDb): Promise<InvariantSummary["findings"]> {
  const open = Prisma.sql`status::text IN (${list(OPEN)}) AND ${person("user_id")}`;
  const openFinding = (where: Prisma.Sql) =>
    one(db, Prisma.sql`SELECT count(*)::int AS n FROM findings WHERE ${open} AND ${where}`);
  const [all, negativeSaving, questionWithDollars, subscriptionSavingOffItsCost] =
    await Promise.all([
      openFinding(Prisma.sql`TRUE`),
      openFinding(Prisma.sql`annual_savings_cents < 0`),
      openFinding(
        Prisma.sql`status::text IN (${list(WANTS_AN_ANSWER)}) AND type = 'subscription_review'
          AND annual_savings_cents IS NOT NULL AND evidence->>'onlyItsPrice' = 'true'`,
      ),
      openFinding(
        Prisma.sql`type = 'subscription_review' AND annual_savings_cents IS NOT NULL
          AND (evidence->>'annualCostCents')::bigint <> annual_savings_cents`,
      ),
    ]);
  // A fee finding's total, against the rows it lists; then those rows against what's stored.
  const [feeTotalOffItsRows, restsOnMissingRows] = await Promise.all([
    one(
      db,
      Prisma.sql`SELECT count(*)::int AS n FROM findings f
        WHERE f.status::text IN (${list(OPEN)}) AND ${person("f.user_id")} AND f.type = 'bank_fees'
          AND jsonb_typeof(f.evidence->'transactions') = 'array'
          AND f.amount_cents IS DISTINCT FROM (
            SELECT sum((e->>'amountCents')::bigint)
            FROM jsonb_array_elements(f.evidence->'transactions') e
          )`,
    ),
    one(
      db,
      Prisma.sql`SELECT count(*)::int AS n FROM findings f
        WHERE f.status::text IN (${list(OPEN)}) AND ${person("f.user_id")} AND f.type = 'bank_fees'
          AND jsonb_typeof(f.evidence->'transactions') = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(f.evidence->'transactions') e
            WHERE NOT EXISTS (
              SELECT 1 FROM transactions t
              WHERE t.id = e->>'id' AND t.user_id = f.user_id
                AND t.amount_cents::bigint = (e->>'amountCents')::bigint
            )
          )`,
    ),
  ]);
  return {
    open: all,
    negativeSaving,
    questionWithDollars,
    feeTotalOffItsRows,
    subscriptionSavingOffItsCost,
    restsOnMissingRows,
  };
}

async function categoryCounts(db: SystemDb): Promise<InvariantSummary["categories"]> {
  const [row] = await db.$queryRaw<(InvariantSummary["categories"] & Counted)[]>(
    Prisma.sql`SELECT count(*)::int AS rows,
        (count(*) FILTER (WHERE pfc_detailed IS NULL))::int AS uncategorized,
        (count(*) FILTER (WHERE category_source::text = 'llm'))::int AS "byClaude",
        (count(*) FILTER (WHERE category_source::text = 'user'))::int AS "correctedByPerson"
      FROM transactions
      WHERE ${person("user_id")}
        AND date > now() - make_interval(days => ${INVARIANT_WINDOW_DAYS})`,
  );
  return {
    rows: row?.rows ?? 0,
    uncategorized: row?.uncategorized ?? 0,
    byClaude: row?.byClaude ?? 0,
    correctedByPerson: row?.correctedByPerson ?? 0,
  };
}

// Stripe's clearing, for the one kind of money that always has two sides here: paying a card from
// checking, for someone with both on file, should appear on the card too, at the same amount.
async function cardPaymentCounts(db: SystemDb): Promise<InvariantSummary["cardPayments"]> {
  const [row] = await db.$queryRaw<InvariantSummary["cardPayments"][]>(
    Prisma.sql`WITH legs AS (
        SELECT t.user_id, t.date, t.amount_cents
        FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE ${person("t.user_id")}
          AND t.pfc_detailed = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'
          AND t.amount_cents > 0 AND a.type <> 'credit'
          AND t.date > now() - make_interval(days => ${INVARIANT_WINDOW_DAYS})
          AND t.date < now() - make_interval(days => ${CARD_PAYMENT_SETTLE_DAYS})
          AND EXISTS (
            SELECT 1 FROM transactions c JOIN accounts ca ON ca.id = c.account_id
            WHERE c.user_id = t.user_id AND ca.type = 'credit'
              AND c.date > t.date - make_interval(days => ${CARD_PAYMENT_MATCH_DAYS})
          )
      )
      SELECT count(*)::int AS legs,
        (count(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM transactions c JOIN accounts ca ON ca.id = c.account_id
          WHERE c.user_id = legs.user_id AND ca.type = 'credit'
            AND c.amount_cents = -legs.amount_cents
            AND c.date BETWEEN legs.date - make_interval(days => ${CARD_PAYMENT_MATCH_DAYS})
              AND legs.date + make_interval(days => ${CARD_PAYMENT_MATCH_DAYS})
        )))::int AS unmatched
      FROM legs`,
  );
  return { legs: row?.legs ?? 0, unmatched: row?.unmatched ?? 0 };
}

// Whatever rules are NOT VALID today, from the catalog, so a new one is counted with no change here.
// The SQL is built only from what the catalog says about Jane's own schema, never from a row.
async function constraintCounts(db: SystemDb): Promise<InvariantSummary["constraints"]> {
  const rules = await db.$queryRaw<{ tbl: string; rule: string; expr: string }[]>(
    Prisma.sql`SELECT conrelid::regclass::text AS tbl, conname AS rule,
        pg_get_expr(conbin, conrelid) AS expr
      FROM pg_constraint
      WHERE contype = 'c' AND NOT convalidated AND connamespace = 'public'::regnamespace
      ORDER BY conname`,
  );
  const oldRows: Record<string, number> = {};
  for (const { tbl, rule, expr } of rules) {
    const [row] = await db.$queryRawUnsafe<Counted[]>(
      `SELECT count(*)::int AS n FROM ${tbl} WHERE NOT (${expr})`,
    );
    if ((row?.n ?? 0) > 0) oldRows[rule] = row!.n;
  }
  return {
    unvalidated: rules.length,
    rulesWithOldRows: Object.keys(oldRows).length,
    oldRows,
  };
}

const MUST_BE_ZERO = ["negativeSaving", "questionWithDollars", "feeTotalOffItsRows"] as const;

export async function runInvariants({
  client = defaultClient,
}: { client?: PrismaClient } = {}): Promise<InvariantSummary> {
  const db = systemDb(WHY, client);
  const [people, findings, categories, cardPayments, constraints, recent, warned] =
    await Promise.all([
      one(db, Prisma.sql`SELECT count(*)::int AS n FROM users WHERE ${person("id")}`),
      findingCounts(db),
      categoryCounts(db),
      cardPaymentCounts(db),
      constraintCounts(db),
      one(
        db,
        Prisma.sql`SELECT count(*)::int AS n FROM import_runs
          WHERE ${person("user_id")}
            AND created_at > now() - make_interval(days => ${INVARIANT_WINDOW_DAYS})`,
      ),
      one(
        db,
        Prisma.sql`SELECT count(*)::int AS n FROM import_runs
          WHERE ${person("user_id")} AND cardinality(control_warnings) > 0
            AND created_at > now() - make_interval(days => ${INVARIANT_WINDOW_DAYS})`,
      ),
    ]);
  return {
    people,
    findings,
    imports: { recent, withControlWarnings: warned },
    categories,
    cardPayments,
    constraints,
    broken: MUST_BE_ZERO.filter((name) => findings[name] > 0),
  };
}
