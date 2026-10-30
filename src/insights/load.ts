import type { ScopedDb } from "@/lib/db-scoped";
import { monthsEnding, type InsightTransaction } from "./spending";

// The transactions insights and budgets read: everything from the start of the first
// month, as stored. One loader, so the two pages (and over-budget alerts) always agree.
export async function loadInsightTransactions(
  db: Pick<ScopedDb, "transactions">,
  asOf: string,
  monthCount: number,
): Promise<InsightTransaction[]> {
  const [first] = monthsEnding(asOf, monthCount);
  const rows = await db.transactions.findMany({
    where: { date: { gte: new Date(`${first}-01T00:00:00Z`) } },
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
