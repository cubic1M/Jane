import type { PrismaClient } from "@/generated/prisma/client";
import type { PortfolioReview } from "@/insights/portfolio-review";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { Investments } from "./holdings";

// What the monthly portfolio note (spec step 137) needs beyond the other investment loaders:
// the total a month ago, from daily snapshots, and what went in last month.

export async function loadMonthFacts(
  userId: string,
  investments: Investments,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<{ month: string; previousCents: number | null; contributedCents: number }> {
  const month = now.toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 2, 1));
  const end = new Date(Date.UTC(y, m - 1, 1));
  const rows = await scopedFor(userId, client).investmentTransactions.findMany({
    where: { subtype: { in: ["contribution", "deposit"] }, date: { gte: start, lt: end } },
    select: { amountCents: true },
  });
  // Month ends, oldest first, ending this month: the month before last ended a month ago.
  const previous = investments.months.at(-3)?.totalCents ?? null;
  return {
    month,
    previousCents: previous,
    // Money in is negative in Plaid's sign.
    contributedCents: rows.reduce((s, r) => s - r.amountCents, 0),
  };
}

export type { PortfolioReview };
