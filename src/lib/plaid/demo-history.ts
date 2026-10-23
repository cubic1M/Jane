import { NET_WORTH_MONTHS } from "@/config/net-worth";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// A sample person's past balances (the home hub's net worth line, docs/design/home-hub.md).
// Real accounts get a balance snapshot each day from the daily job (src/lib/snapshots.ts), so
// their line fills in over the months; a demo-bank person is new every time, so on the first
// scan their accounts get a month-end balance for each of the last months, worked back from
// today's balance through their own transactions. Demo bank only: a stand-in for history a
// real bank would have, never written for real accounts.

export type HistoryAccount = { id: string; type: string; currentBalanceCents: number | null };
export type HistoryTransaction = { accountId: string; date: string; amountCents: number };
export type PastBalance = { accountId: string; date: string; balanceCents: number };

const DEBT_TYPES = new Set(["credit", "loan"]);

// The last day of each of the `months` months before the month of `asOf`, oldest first.
export function pastMonthEnds(asOf: string, months: number): string[] {
  const [y, m] = asOf.split("-").map(Number);
  return Array.from({ length: months }, (_, i) =>
    new Date(Date.UTC(y, m - 1 - (months - 1 - i), 0)).toISOString().slice(0, 10),
  );
}

// Each account's balance at the end of each past month: today's balance with the
// transactions since then undone. Plaid's amounts are money out positive: out of a bank
// account it lowered the balance, on a card or loan it raised what's owed. Only months the
// account's transactions reach back to, and only accounts that move through transactions
// (banks, cards and loans; investment balances stay out).
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
    if (own.length === 0) continue;
    const first = own.reduce((d, t) => (t.date < d ? t.date : d), own[0].date);
    const sign = DEBT_TYPES.has(a.type) ? -1 : 1;
    for (const end of ends) {
      if (end < first) continue;
      const since = own.filter((t) => t.date > end).reduce((sum, t) => sum + t.amountCents, 0);
      out.push({ accountId: a.id, date: end, balanceCents: a.currentBalanceCents + sign * since });
    }
  }
  return out;
}

// Writes the past month-end balances for one demo item's accounts. Never overwrites a day
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
  const balances = pastMonthEndBalances(
    accounts,
    rows.map((t) => ({ ...t, date: t.date.toISOString().slice(0, 10) })),
    asOf,
    NET_WORTH_MONTHS,
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
