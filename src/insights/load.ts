import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { profileHistoryStart } from "@/config/profile";
import type { ScopedDb } from "@/lib/db-scoped";
import { monthsEnding, type InsightTransaction } from "./spending";
import { typicalMonthlySpending } from "./typical-month";

// The transactions insights and budgets read: everything from the start of the first
// month, as stored. One loader, so the two pages (and over-budget alerts) always agree.
export async function loadInsightTransactions(
  db: Pick<ScopedDb, "transactions">,
  asOf: string,
  monthCount: number,
): Promise<InsightTransaction[]> {
  const [first] = monthsEnding(asOf, monthCount);
  return transactionsSince(db, new Date(`${first}-01T00:00:00Z`));
}

// A typical month's spending for the emergency fund, from the year the cushion card reads (profile
// history, cushionSpendCents): whether a bill is rare can't be told from the few months averaged.
export async function loadTypicalMonthlySpending(
  db: Pick<ScopedDb, "transactions">,
  asOf: string,
  now: Date,
): Promise<number> {
  const rows = await transactionsSince(db, profileHistoryStart(now));
  return typicalMonthlySpending(rows, asOf, BUDGET_SUGGESTION_MONTHS);
}

async function transactionsSince(
  db: Pick<ScopedDb, "transactions">,
  since: Date,
): Promise<InsightTransaction[]> {
  const rows = await db.transactions.findMany({
    where: { date: { gte: since } },
    select: {
      id: true,
      accountId: true,
      date: true,
      amountCents: true,
      description: true,
      merchantName: true,
      pfcPrimary: true,
      pfcDetailed: true,
      pending: true,
    },
  });
  return rows.map((t) => ({ ...t, date: t.date.toISOString().slice(0, 10) }));
}
