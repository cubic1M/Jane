import { DEMO_HISTORY_DAYS, DEMO_HISTORY_LOWEST_BANK_CENTS } from "@/config/net-worth";
import { addDays } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// A sample person's past balances (the home hub's net worth line, docs/design/home-hub.md).
// Real accounts get a balance snapshot each day from the daily job (src/lib/snapshots.ts), so
// their line fills in over the months; a demo-bank person is new every time, so on the first
// scan their accounts get a balance for each day of the last year, worked back from today's
// balance through their own transactions (the hub's net worth chart is daily). Demo bank
// only: a stand-in for history a real bank would have, never written for real accounts.

export type HistoryAccount = { id: string; type: string; currentBalanceCents: number | null };
export type HistoryTransaction = { accountId: string; date: string; amountCents: number };
export type PastBalance = { accountId: string; date: string; balanceCents: number };

const DEBT_TYPES = new Set(["credit", "loan"]);

// Whether worked-back balances are believable: no bank account far overdrawn, no card or loan
// owing less than nothing. If not, the transactions don't explain the balance (phone walk: a
// shop owner's card "owed" -$51,991 a year ago, and their net worth line started at -$174,403).
const credible = (balances: readonly PastBalance[], debt: boolean) =>
  balances.every((b) => b.balanceCents >= (debt ? 0 : DEMO_HISTORY_LOWEST_BANK_CENTS));

// The last day of each of the `months` months before the month of `asOf`, oldest first.
export function pastMonthEnds(asOf: string, months: number): string[] {
  const [y, m] = asOf.split("-").map(Number);
  return Array.from({ length: months }, (_, i) =>
    new Date(Date.UTC(y, m - 1 - (months - 1 - i), 0)).toISOString().slice(0, 10),
  );
}

// Each account's balance at the end of each past month: today's balance with the
// transactions since then undone. Plaid's amounts are money out positive: out of a bank
// account it lowered the balance, on a card or loan it raised what's owed. Every bank, card and
// loan account counts in every month, as it does in today's net worth: one with nothing to undo
// (savings no transaction touched, a mortgage paid from another bank) is at today's balance
// (visitor walk: leaving them out drew a line $400k off the headline). Investment balances
// stay out: the returns read snapshots as real values (the hub's line counts them flat).
export function pastMonthEndBalances(
  accounts: readonly HistoryAccount[],
  transactions: readonly HistoryTransaction[],
  asOf: string,
  months: number,
): PastBalance[] {
  const ends = pastMonthEnds(asOf, months);
  const out: PastBalance[] = [];
  for (const a of accounts) {
    if (a.currentBalanceCents === null) continue;
    if (a.type !== "depository" && !DEBT_TYPES.has(a.type)) continue;
    const own = transactions.filter((t) => t.accountId === a.id);
    const debt = DEBT_TYPES.has(a.type);
    const sign = debt ? -1 : 1;
    const worked = ends.map((end) => {
      const since = own.filter((t) => t.date > end).reduce((sum, t) => sum + t.amountCents, 0);
      return { accountId: a.id, date: end, balanceCents: a.currentBalanceCents! + sign * since };
    });
    // Transactions that don't explain the balance: today's balance.
    out.push(
      ...(credible(worked, debt)
        ? worked
        : worked.map((b) => ({ ...b, balanceCents: a.currentBalanceCents! }))),
    );
  }
  return out;
}

// The same, for every day from `days` days ago to yesterday: what the hub's daily net worth
// chart draws. One pass from today backwards: each day's balance is the next day's with that
// next day's transactions undone.
export function pastDailyBalances(
  accounts: readonly HistoryAccount[],
  transactions: readonly HistoryTransaction[],
  asOf: string,
  days: number,
): PastBalance[] {
  const out: PastBalance[] = [];
  for (const a of accounts) {
    if (a.currentBalanceCents === null) continue;
    if (a.type !== "depository" && !DEBT_TYPES.has(a.type)) continue;
    const debt = DEBT_TYPES.has(a.type);
    const sign = debt ? -1 : 1;
    const byDay = new Map<string, number>();
    for (const t of transactions) {
      if (t.accountId === a.id) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amountCents);
    }
    const worked: PastBalance[] = [];
    let balance = a.currentBalanceCents;
    // Today's transactions are in today's balance; undo them to get yesterday's, and so on.
    for (let d = asOf, i = 0; i < days; i += 1) {
      balance += sign * (byDay.get(d) ?? 0);
      d = addDays(d, -1);
      worked.push({ accountId: a.id, date: d, balanceCents: balance });
    }
    // Transactions that don't explain the balance (phone walk), judged at month ends as the
    // monthly line is (a bank account dips mid-month before payday): no history for the
    // account. The chart counts it at today's balance throughout, and the books check (which
    // compares a day's balance with its transactions) has nothing made up to flag.
    const monthEnd = (d: string) => addDays(d, 1).endsWith("-01");
    if (
      credible(
        worked.filter((b) => monthEnd(b.date)),
        debt,
      )
    ) {
      out.push(...worked.reverse());
    }
  }
  return out;
}

// Writes the past daily balances for one demo item's accounts. Never overwrites a day
// that already has a snapshot.
export async function ensureDemoBalanceHistory(
  userId: string,
  itemId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const accounts = await db.accounts.findMany({
    where: { itemId },
    select: { id: true, type: true, currentBalanceCents: true },
  });
  if (accounts.length === 0) return 0;
  const rows = await db.transactions.findMany({
    where: { accountId: { in: accounts.map((a) => a.id) }, pending: false },
    select: { accountId: true, date: true, amountCents: true },
  });
  const balances = pastDailyBalances(
    accounts,
    rows.map((t) => ({ ...t, date: t.date.toISOString().slice(0, 10) })),
    asOf,
    DEMO_HISTORY_DAYS,
  );
  if (balances.length === 0) return 0;
  const { count } = await db.balanceSnapshots.createMany({
    data: balances.map((b) => ({
      userId,
      accountId: b.accountId,
      date: new Date(`${b.date}T00:00:00Z`),
      balanceCents: b.balanceCents,
    })),
    skipDuplicates: true,
  });
  return count;
}
