import {
  ACCURACY_BUDGET_MS,
  FUTURE_SLACK_DAYS,
  INVARIANT_WINDOW_DAYS,
  PENDING_STALE_DAYS,
} from "@/config/invariants";
import { BOOKS_LOOKBACK_DAYS, BOOKS_RECONCILED_TYPES } from "@/config/books";
import { NOT_FROM_A_BANK } from "@/data-sources/types";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights } from "@/insights/spending";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { addDays } from "@/lib/dates";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isDemoOnly } from "@/lib/digest/recipients";
import { stayingPeople, type OnlyPeople } from "@/lib/only-people";
import { loadHubAreas } from "@/lib/hub/load";
import { loadNetWorthHistory } from "@/lib/net-worth-history";
import { systemDb } from "@/lib/system-db";
import { todayOf } from "@/lib/today";
import { isTrialUser } from "@/lib/trial-ids";
import { copiesToLeaveOut, reconcile } from "@/planning/books";

// Beta accuracy (2026-11-12): what every figure Jane shows a real person must satisfy, checked on
// live data once a day, person by person. Real means not a trial person and not someone with only
// the demo bank: sample data proves nothing about Plaid production. Counts only: each check's name
// and how many of what it looked at passed, failed or didn't apply. No amount, merchant, name, date
// or person leaves this module; the per-person work stays in memory. The summary is kept in
// cron_runs, shown on /admin/accuracy and, when something fails, emailed to the team by check name.

const WHY = "The daily accuracy checks find who to check, across people, and read no row";

export const ACCURACY_CHECKS = [
  {
    name: "balance_matches_history",
    about:
      "Each checking, savings or card account with two or more daily balances: the balance moved by what its transactions say (the books check's rule)",
  },
  {
    name: "suggestion_figures_trace",
    about:
      "Each open suggestion with a dollar figure: every transaction it names is still there, settled, at the same amount, and every balance it names is today's",
  },
  {
    name: "recurring_two_occurrences",
    about: "Each open suggestion about something recurring rests on two or more charges",
  },
  {
    name: "no_duplicate_transactions",
    about:
      "Each settled transaction of the last 90 days: no other on an account of the same kind has its date, amount and words (a few can be real: two of the same coffee on one day)",
  },
  {
    name: "no_stale_pending",
    about: "Each pending transaction is under 14 days old, so its posting or removal wasn't missed",
  },
  {
    name: "no_future_transactions",
    about: "Each transaction is dated on or before the person's today",
  },
  {
    name: "areas_add_up_to_home",
    about:
      "Home's net worth is the Money page's; Home's Money tile is the Money page's month; each month's categories and refunds add up to its spending",
  },
] as const;

type AccuracyCheckName = (typeof ACCURACY_CHECKS)[number]["name"];
export type Tally = { passed: number; failed: number; notApplicable: number };
type CheckTally = Tally & { name: AccuracyCheckName };
export type AccuracySummary = {
  // Real people with accounts, and how many the run reached in its time.
  people: number;
  checked: number;
  notChecked: number;
  // A person whose checks threw: counted, never named.
  errored: number;
  checks: CheckTally[];
  // The names of the checks with a failure.
  failing: AccuracyCheckName[];
};

type Tallies = Record<AccuracyCheckName, Tally>;

const empty = (): Tallies =>
  Object.fromEntries(
    ACCURACY_CHECKS.map((c) => [c.name, { passed: 0, failed: 0, notApplicable: 0 }]),
  ) as Tallies;

const add = (into: Tallies, from: Partial<Tallies>) => {
  for (const [name, t] of Object.entries(from) as [AccuracyCheckName, Tally][]) {
    into[name].passed += t.passed;
    into[name].failed += t.failed;
    into[name].notApplicable += t.notApplicable;
  }
};

const tally = (results: readonly boolean[], notApplicable = 0): Tally => ({
  passed: results.filter(Boolean).length,
  failed: results.filter((ok) => !ok).length,
  notApplicable,
});

const iso = (d: Date) => d.toISOString().slice(0, 10);

// --- The checks, pure: one person's rows in, tallies out ---

export type AccountRow = {
  id: string;
  type: string;
  subtype: string | null;
  itemId: string | null;
  mask: string | null;
  currentBalanceCents: number | null;
};
export type TransactionRow = {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  description: string;
  pending: boolean;
};
export type SnapshotRow = { accountId: string; date: string; balanceCents: number };
export type FindingRow = {
  type: string;
  amountCents: number | null;
  annualSavingsCents: number | null;
  evidence: unknown;
};

export function balanceChecks(
  accounts: readonly AccountRow[],
  snapshots: readonly SnapshotRow[],
  transactions: readonly TransactionRow[],
): Tally {
  const copies = copiesToLeaveOut([...accounts]);
  const results: boolean[] = [];
  let notApplicable = 0;
  for (const account of accounts) {
    if (copies.has(account.id) || !BOOKS_RECONCILED_TYPES.includes(account.type)) continue;
    const snaps = snapshots
      .filter((s) => s.accountId === account.id)
      .map(({ date, balanceCents }) => ({ date, balanceCents }));
    if (snaps.length < 2) {
      notApplicable += 1;
      continue;
    }
    const txns = transactions
      .filter((t) => t.accountId === account.id && !t.pending)
      .map((t) => ({ ...t, pfcPrimary: null }));
    results.push(reconcile(account.type, snaps, txns) === null);
  }
  return tally(results, notApplicable);
}

// The rows and balances a suggestion's evidence names: any object with an id, a date and an amount
// is a transaction; one with an id and a balance is an account.
export function evidenceRefs(evidence: unknown): {
  transactions: { id: string; amountCents: number }[];
  accounts: { id: string; balanceCents: number | null }[];
} {
  const transactions: { id: string; amountCents: number }[] = [];
  const accounts: { id: string; balanceCents: number | null }[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== "object") return;
    const o = value as Record<string, unknown>;
    if (typeof o.id === "string" && typeof o.date === "string" && typeof o.amountCents === "number")
      transactions.push({ id: o.id, amountCents: o.amountCents });
    else if (typeof o.id === "string" && "balanceCents" in o)
      accounts.push({
        id: o.id,
        balanceCents: typeof o.balanceCents === "number" ? o.balanceCents : null,
      });
    Object.values(o).forEach(walk);
  };
  walk(evidence);
  return { transactions, accounts };
}

const hasDollars = (f: FindingRow) => (f.amountCents ?? 0) > 0 || (f.annualSavingsCents ?? 0) > 0;
const isRecurring = (f: FindingRow) =>
  typeof (f.evidence as Record<string, unknown> | null)?.frequency === "string";

export function findingChecks(
  findings: readonly FindingRow[],
  stored: ReadonlyMap<string, { amountCents: number; pending: boolean }>,
  balances: ReadonlyMap<string, number | null>,
): Pick<Tallies, "suggestion_figures_trace" | "recurring_two_occurrences"> {
  const traced: boolean[] = [];
  let untraced = 0;
  const recurring: boolean[] = [];
  for (const f of findings) {
    const refs = evidenceRefs(f.evidence);
    if (isRecurring(f)) recurring.push(new Set(refs.transactions.map((t) => t.id)).size >= 2);
    if (!hasDollars(f)) continue;
    if (refs.transactions.length === 0 && refs.accounts.length === 0) {
      untraced += 1;
      continue;
    }
    traced.push(
      refs.transactions.every((r) => {
        const row = stored.get(r.id);
        return row !== undefined && !row.pending && row.amountCents === r.amountCents;
      }) &&
        refs.accounts.every(
          (a) =>
            balances.has(a.id) &&
            (a.balanceCents === null || balances.get(a.id) === a.balanceCents),
        ),
    );
  }
  return {
    suggestion_figures_trace: tally(traced, untraced),
    recurring_two_occurrences: tally(recurring, findings.length - recurring.length),
  };
}

export function transactionChecks(
  accounts: readonly AccountRow[],
  transactions: readonly TransactionRow[],
  asOf: string,
): Pick<Tallies, "no_duplicate_transactions" | "no_stale_pending" | "no_future_transactions"> {
  const copies = copiesToLeaveOut([...accounts]);
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const counted = transactions.filter((t) => !copies.has(t.accountId));
  const seen = new Set<string>();
  const duplicates = counted
    .filter((t) => !t.pending)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => {
      const key = [
        typeOf.get(t.accountId),
        t.date,
        t.amountCents,
        t.description.trim().toLowerCase(),
      ].join("|");
      const first = !seen.has(key);
      seen.add(key);
      return first;
    });
  const stale = addDays(asOf, -PENDING_STALE_DAYS);
  const latest = addDays(asOf, FUTURE_SLACK_DAYS);
  const pending = counted.filter((t) => t.pending);
  return {
    no_duplicate_transactions: tally(duplicates),
    no_stale_pending: tally(
      pending.map((t) => t.date >= stale),
      counted.length - pending.length,
    ),
    no_future_transactions: tally(counted.map((t) => t.date <= latest)),
  };
}

export type AddsUpInput = {
  homeNetWorthCents: number | null;
  moneyNetWorthCents: number | null;
  tileMonth: { month: string; spendingCents: number } | null;
  pageMonth: { month: string; spendingCents: number } | null;
  months: {
    month: string;
    spendingCents: number;
    categoriesCents: number[];
    refundsCents: number[];
  }[];
};

export function addsUpChecks(input: AddsUpInput): Pick<Tallies, "areas_add_up_to_home"> {
  const results: boolean[] = [];
  let notApplicable = 0;
  if (input.homeNetWorthCents === null || input.moneyNetWorthCents === null) notApplicable += 1;
  else results.push(input.homeNetWorthCents === input.moneyNetWorthCents);
  if (!input.tileMonth || !input.pageMonth || input.tileMonth.month !== input.pageMonth.month)
    notApplicable += 1;
  else results.push(input.tileMonth.spendingCents === input.pageMonth.spendingCents);
  for (const m of input.months) {
    const net = [...m.categoriesCents, ...m.refundsCents].reduce((s, c) => s + c, 0);
    // A month whose refunds came to more than was bought shows $0, never below.
    results.push(m.spendingCents === Math.max(0, net));
  }
  return { areas_add_up_to_home: tally(results, notApplicable) };
}

// --- One person, from the database ---

const OPEN_FINDINGS = ["new", "shown", "approved", "in_progress"] as const;
// Each month's parts are checked for the months the Money page and tile show.
const MONTHS_CHECKED = 3;

async function checkPerson(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<Tallies> {
  const db = scopedFor(userId, client);
  const asOf = await todayOf(userId, { client, now });
  const since = new Date(`${addDays(asOf, -INVARIANT_WINDOW_DAYS)}T00:00:00Z`);
  const booksSince = new Date(`${addDays(asOf, -BOOKS_LOOKBACK_DAYS)}T00:00:00Z`);
  const [accounts, transactions, snapshots, findings] = await Promise.all([
    db.accounts.findMany({
      select: {
        id: true,
        type: true,
        subtype: true,
        itemId: true,
        mask: true,
        currentBalanceCents: true,
      },
    }),
    db.transactions.findMany({
      where: { date: { gte: since } },
      select: {
        id: true,
        accountId: true,
        date: true,
        amountCents: true,
        description: true,
        pending: true,
      },
    }),
    db.balanceSnapshots.findMany({
      where: { date: { gte: booksSince } },
      select: { accountId: true, date: true, balanceCents: true },
    }),
    db.findings.findMany({
      where: { status: { in: [...OPEN_FINDINGS] } },
      select: { type: true, amountCents: true, annualSavingsCents: true, evidence: true },
    }),
  ]);
  const rows = transactions.map((t) => ({ ...t, date: iso(t.date) }));
  // What the suggestions name, wherever it is: an old charge is outside the 90 days.
  const named = [
    ...new Set(findings.flatMap((f) => evidenceRefs(f.evidence).transactions.map((t) => t.id))),
  ];
  const namedRows =
    named.length === 0
      ? []
      : await db.transactions.findMany({
          where: { id: { in: named } },
          select: { id: true, amountCents: true, pending: true },
        });

  const [worth, money, areas, insight] = await Promise.all([
    loadNetWorthHistory(userId, { client, now }),
    loadMoneyArea(userId, { client, now }),
    loadHubAreas(userId, { budgetsOver: 0, safeShort: false }, { client, now }),
    loadInsightTransactions(db, asOf, MONTHS_CHECKED).then((t) =>
      spendingInsights(t, { asOf, monthCount: MONTHS_CHECKED }),
    ),
  ]);
  const tile = areas.money?.months.at(-1) ?? null;
  const tallies = empty();
  add(tallies, {
    balance_matches_history: balanceChecks(
      accounts,
      snapshots.map((s) => ({ ...s, date: iso(s.date) })),
      rows,
    ),
    ...findingChecks(
      findings,
      new Map(namedRows.map((t) => [t.id, t])),
      new Map(accounts.map((a) => [a.id, a.currentBalanceCents])),
    ),
    ...transactionChecks(accounts, rows, asOf),
    ...addsUpChecks({
      homeNetWorthCents: worth?.known ? worth.todayCents : null,
      moneyNetWorthCents: money.have.netKnown ? money.have.netCents : null,
      tileMonth: tile,
      pageMonth: money.spending
        ? { month: money.spending.month, spendingCents: money.spending.spendingCents }
        : null,
      months: insight.months.map((m) => ({
        month: m.month,
        spendingCents: m.spendingCents,
        categoriesCents: (insight.categoriesByMonth[m.month] ?? []).map((c) => c.cents),
        refundsCents: (insight.refundsByMonth[m.month] ?? []).map((c) => c.cents),
      })),
    }),
  });
  return tallies;
}

// --- Everyone ---

// Real people with something to check: not a trial person, not deleted, with accounts, and not
// only the demo bank.
async function realPeople({
  client = defaultClient,
  userIds,
}: { client?: PrismaClient } & OnlyPeople = {}): Promise<string[]> {
  const users = await systemDb(WHY, client).user.findMany({
    where: { deletedAt: null, accounts: { some: {} }, ...stayingPeople(userIds) },
    select: {
      id: true,
      plaidItems: { select: { plaidItemId: true } },
      _count: { select: { accounts: { where: { source: { in: [...NOT_FROM_A_BANK] } } } } },
    },
    orderBy: { id: "asc" },
  });
  return users
    .filter(
      (u) =>
        !isTrialUser(u.id) &&
        !isDemoOnly(
          u.plaidItems.map((i) => i.plaidItemId),
          u._count.accounts,
        ),
    )
    .map((u) => u.id);
}

export async function runAccuracyChecks({
  client = defaultClient,
  now = new Date(),
  budgetMs = ACCURACY_BUDGET_MS,
  clock = () => Date.now(),
  userIds,
}: {
  client?: PrismaClient;
  now?: Date;
  budgetMs?: number;
  clock?: () => number;
} & OnlyPeople = {}): Promise<AccuracySummary> {
  const started = clock();
  const people = await realPeople({ client, userIds });
  const tallies = empty();
  let checked = 0;
  let errored = 0;
  for (const userId of people) {
    if (clock() - started > budgetMs) break;
    try {
      add(tallies, await checkPerson(userId, { client, now }));
      checked += 1;
    } catch {
      // Never the error's words: they could carry a person's data. Counted, and the run goes on.
      errored += 1;
    }
  }
  const checks = ACCURACY_CHECKS.map((c) => ({ name: c.name, ...tallies[c.name] }));
  return {
    people: people.length,
    checked,
    notChecked: people.length - checked - errored,
    errored,
    checks,
    failing: checks.filter((c) => c.failed > 0).map((c) => c.name),
  };
}

// The latest finished run, for /admin/accuracy and the team's email: the stored counts, never a
// fresh run on a page load.
export async function latestAccuracy({
  client = defaultClient,
}: { client?: PrismaClient } = {}): Promise<{ at: Date; summary: AccuracySummary } | null> {
  const run = await systemDb(WHY, client).cronRun.findFirst({
    where: { name: ACCURACY_JOB, ok: true },
    orderBy: { startedAt: "desc" },
    select: { finishedAt: true, startedAt: true, summary: true },
  });
  if (!run?.summary) return null;
  return {
    at: run.finishedAt ?? run.startedAt,
    summary: run.summary as unknown as AccuracySummary,
  };
}

export const ACCURACY_JOB = "accuracy";
