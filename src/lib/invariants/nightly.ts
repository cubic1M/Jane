import {
  CARD_PAYMENT_MATCH_DAYS,
  CARD_PAYMENT_SETTLE_DAYS,
  INVARIANT_WINDOW_DAYS,
  TAX_CHECK_ZONE,
  TAX_DRAFT_MAX_DAYS,
  TAX_PARAMS_LEAD_DAYS,
} from "@/config/invariants";
import {
  DRAFT_TAX_YEARS,
  pendingGroups,
  SUPPORTED_TAX_YEARS,
  type PendingGroup,
} from "@/config/tax-params";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { localDate } from "@/lib/today";
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
// Who's counted: everyone but sample people, or one person when a test asks (so rows other test
// files write at the same time aren't counted in: main 11-17, a card payment test read 3 legs for 1).
type Person = (column: string) => Prisma.Sql;
const personFilter =
  (only?: string): Person =>
  (column) =>
    only === undefined
      ? Prisma.sql`${Prisma.raw(column)} NOT LIKE ${TRIAL}`
      : Prisma.sql`${Prisma.raw(column)} = ${only}`;

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
  // Are there tax figures for the year people are in and the one about to start (Tax T32)?
  // Only the state and a count: the lines themselves go in the daily accuracy email.
  taxYear: { state: TaxYearReady["state"]; problems: number };
  // The names of what must be 0 and isn't.
  broken: string[];
};

async function one(db: SystemDb, query: Prisma.Sql): Promise<number> {
  const [row] = await db.$queryRaw<Counted[]>(query);
  return row?.n ?? 0;
}

async function findingCounts(db: SystemDb, person: Person): Promise<InvariantSummary["findings"]> {
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

async function categoryCounts(
  db: SystemDb,
  person: Person,
): Promise<InvariantSummary["categories"]> {
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
async function cardPaymentCounts(
  db: SystemDb,
  person: Person,
): Promise<InvariantSummary["cardPayments"]> {
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

export type TaxYearReady = {
  // ok; warning (act this month); red (a year people are already in has no figures).
  state: "ok" | "warning" | "red";
  // The day the check ran for (see taxCheckDay).
  day: string;
  // Years and group names only: nothing about a person.
  messages: string[];
};

const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

// The day to check for: the one on the furthest-ahead clock (UTC+14), so the warning comes when the
// first person's day reaches the date, not the last's (Tax T32; src/lib/today.ts).
export const taxCheckDay = (now: Date): string => localDate(now, TAX_CHECK_ZONE);

// Does Jane have figures for the year people are in, and for the year about to start? From
// December 1 a missing next year warns; from January 1 a missing current year is red; a draft
// year or an IRS-draft figure not looked at for TAX_DRAFT_MAX_DAYS warns. Pure: the figures
// come in as arguments (the real ones by default). Tax T32, docs/tax/law-change.md.
export function taxYearReady(
  day: string,
  {
    supported = SUPPORTED_TAX_YEARS,
    drafts = DRAFT_TAX_YEARS,
    pending = pendingGroups(),
  }: {
    supported?: readonly number[];
    drafts?: readonly number[];
    pending?: readonly PendingGroup[];
  } = {},
): TaxYearReady {
  const year = Number(day.slice(0, 4));
  const messages: string[] = [];
  let state: TaxYearReady["state"] = "ok";
  const raise = (to: "warning" | "red", message: string) => {
    messages.push(message);
    if (to === "red" || state === "ok") state = to;
  };
  const awaited = (y: number) => {
    const groups = pending.filter((g) => g.year === y).map((g) => g.key);
    if (groups.length > 0) return ` (a draft file exists; not final: ${groups.join(", ")})`;
    return drafts.includes(y) ? " (a draft file exists)" : "";
  };

  if (!supported.includes(year)) {
    raise("red", `No tax figures for ${year}, the year people are in${awaited(year)}`);
  }
  const leadStart = dayOf(`${year + 1}-01-01`) - TAX_PARAMS_LEAD_DAYS * DAY_MS;
  if (dayOf(day) >= leadStart && !supported.includes(year + 1)) {
    raise(
      "warning",
      `No tax figures for ${year + 1} yet; ${year + 1} starts soon${awaited(year + 1)}`,
    );
  }
  const limit = dayOf(day) - TAX_DRAFT_MAX_DAYS * DAY_MS;
  for (const g of pending) {
    if (dayOf(g.checkedOn) < limit) {
      raise("warning", `${g.year} ${g.key} is still ${g.status}, last read ${g.checkedOn}`);
    }
  }
  return { state, day, messages };
}

export async function runInvariants({
  client = defaultClient,
  only,
  now = new Date(),
}: { client?: PrismaClient; only?: string; now?: Date } = {}): Promise<InvariantSummary> {
  const db = systemDb(WHY, client);
  const person = personFilter(only);
  const taxYear = taxYearReady(taxCheckDay(now));
  const [people, findings, categories, cardPayments, constraints, recent, warned] =
    await Promise.all([
      one(db, Prisma.sql`SELECT count(*)::int AS n FROM users WHERE ${person("id")}`),
      findingCounts(db, person),
      categoryCounts(db, person),
      cardPaymentCounts(db, person),
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
    taxYear: { state: taxYear.state, problems: taxYear.messages.length },
    broken: [
      ...MUST_BE_ZERO.filter((name) => findings[name] > 0),
      ...(taxYear.state === "red" ? ["taxYearReady"] : []),
    ],
  };
}
