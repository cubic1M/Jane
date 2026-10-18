import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { yearReview } from "@/insights/year";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { savedToDate } from "@/lib/membership/service";

// Everything /year shows for one person and year: spending (from the insights totals),
// what Jane found, and what was saved (from saved-to-date, limited to that year).
export async function yearInReview(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
) {
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const end = `${year}-12-31` < asOf ? `${year}-12-31` : asOf;
  // This year's months and all of last year's, for the comparison.
  const transactions = await loadInsightTransactions(db, end, 12 + Number(end.slice(5, 7)));
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const [found, saved, first] = await Promise.all([
    db.findings.aggregate({
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { annualSavingsCents: true },
    }),
    savedToDate(userId, { client, between: { from, to } }),
    db.transactions.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  return {
    ...yearReview(transactions, year, asOf),
    found: { findings: found._count._all, annualSavingsCents: found._sum.annualSavingsCents ?? 0 },
    savedCents: saved,
    firstYear: first ? first.date.getUTCFullYear() : now.getUTCFullYear(),
  };
}
