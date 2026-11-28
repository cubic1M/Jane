import {
  DEMO_HISTORY_LOWEST_BANK_CENTS,
  PAST_BALANCES_MAX_DAYS,
  PAST_BALANCE_SOURCE,
} from "@/config/net-worth";
import { addDays } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isoDay } from "@/lib/dates";
import { todayFor } from "@/lib/today";

// A linked bank's past balances, so net worth's ALL reaches back as far as the transactions do.
// Plaid gives today's balance, not past ones, and the daily job's snapshots only begin the day the
// person linked. Before that, each bank and card account's balance is worked back from its first
// snapshot's through its posted transactions: the balance at the end of day d-1 is the balance at
// the end of day d with day d's transactions undone (Plaid's amounts are money out positive: out of
// a bank account it lowered the balance, on a card it raised what is owed). Every account is
// worked on its own, so a move between two of the person's accounts is counted once on each side
// and nets to nothing. Pending transactions are not in a balance and are left out. Days from the
// first snapshot on are never touched, so today's figure and every real day stay exactly as they
// were. Accounts whose past can't be worked back (investments, loans, anything owned) carry their
// first known value flat, as the chart already does; nothing is invented for them.

const DEBT_TYPES = new Set(["credit", "loan"]);
const WORKED_TYPES = new Set(["depository", "credit"]);

export type PastAccount = { id: string; type: string; anchorDay: string; anchorCents: number };
export type PastTransaction = { accountId: string; date: string; amountCents: number };
export type PastBalance = { accountId: string; date: string; balanceCents: number };

// Whether worked-back balances are believable (as src/lib/plaid/demo-history.ts): judged at month
// ends, no bank account far overdrawn and no card owing less than nothing. If not, the transactions
// don't explain the balance and the account gets no history.
const credible = (balances: readonly PastBalance[], debt: boolean) =>
  balances
    .filter((b) => addDays(b.date, 1).endsWith("-01"))
    .every((b) => b.balanceCents >= (debt ? 0 : DEMO_HISTORY_LOWEST_BANK_CENTS));

// Each account's balance at the end of every day from the day before its first transaction to the
// day before its anchor (the first day it has a real balance), oldest first. Pure.
export function workBackBalances(
  accounts: readonly PastAccount[],
  transactions: readonly PastTransaction[],
  maxDays = PAST_BALANCES_MAX_DAYS,
): PastBalance[] {
  const out: PastBalance[] = [];
  for (const a of accounts) {
    if (!WORKED_TYPES.has(a.type)) continue;
    const debt = DEBT_TYPES.has(a.type);
    const sign = debt ? -1 : 1;
    const byDay = new Map<string, number>();
    for (const t of transactions) {
      if (t.accountId === a.id) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amountCents);
    }
    const days = [...byDay.keys()].filter((d) => d <= a.anchorDay).sort();
    if (days.length === 0) continue;
    const floor = addDays(a.anchorDay, -maxDays);
    // The day before the first transaction holds the balance before any of them.
    const first = addDays(days[0], -1) < floor ? floor : addDays(days[0], -1);
    const worked: PastBalance[] = [];
    let balance = a.anchorCents;
    for (let day = a.anchorDay; day > first;) {
      balance += sign * (byDay.get(day) ?? 0);
      day = addDays(day, -1);
      worked.push({ accountId: a.id, date: day, balanceCents: balance });
    }
    if (credible(worked, debt)) out.push(...worked.reverse());
  }
  return out;
}

// Makes the person's worked-back rows again from what is stored (after a sync that changed
// transactions): only this module's own rows are replaced, and only for the days before each
// account's first real snapshot. Returns how many rows it wrote.
export async function rebuildPastBalances(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const today = await todayFor(db, now);
  const accounts = await db.accounts.findMany({
    where: { source: "plaid", type: { in: [...WORKED_TYPES] }, currentBalanceCents: { not: null } },
    select: { id: true, type: true, currentBalanceCents: true },
  });
  if (accounts.length === 0) return 0;
  const ids = accounts.map((a) => a.id);
  const [real, rows] = await Promise.all([
    db.balanceSnapshots.findMany({
      where: { accountId: { in: ids }, source: null },
      orderBy: { date: "asc" },
      select: { accountId: true, date: true, balanceCents: true },
    }),
    db.transactions.findMany({
      where: { accountId: { in: ids }, pending: false },
      select: { accountId: true, date: true, amountCents: true },
    }),
  ]);
  const earliest = new Map<string, { day: string; cents: number }>();
  for (const s of real) {
    if (!earliest.has(s.accountId))
      earliest.set(s.accountId, { day: isoDay(s.date), cents: s.balanceCents });
  }
  const anchored = accounts.map((a) => {
    const first = earliest.get(a.id);
    // No daily snapshot yet: today's balance, as of today (the daily job writes that row).
    return first
      ? { id: a.id, type: a.type, anchorDay: first.day, anchorCents: first.cents }
      : { id: a.id, type: a.type, anchorDay: today, anchorCents: a.currentBalanceCents ?? 0 };
  });
  const balances = workBackBalances(
    anchored,
    rows.map((t) => ({ accountId: t.accountId, date: isoDay(t.date), amountCents: t.amountCents })),
  );
  await db.balanceSnapshots.deleteMany({
    where: { accountId: { in: ids }, source: PAST_BALANCE_SOURCE },
  });
  if (balances.length === 0) return 0;
  const { count } = await db.balanceSnapshots.createMany({
    data: balances.map((b) => ({
      userId,
      accountId: b.accountId,
      date: new Date(`${b.date}T00:00:00Z`),
      balanceCents: b.balanceCents,
      source: PAST_BALANCE_SOURCE,
    })),
    // A day that already has a real balance keeps it.
    skipDuplicates: true,
  });
  return count;
}
