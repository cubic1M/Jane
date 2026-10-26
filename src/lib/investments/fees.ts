import { ACCOUNT_FEE_SUBTYPES, ADVISORY_FEE_SUBTYPES } from "@/config/market-assumptions";
import type { PrismaClient } from "@/generated/prisma/client";
import { feeSummary, type FeeSummary } from "@/insights/investment-fees";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadInvestments, type Investments } from "./holdings";

// What investing costs the person (spec step 130), loaded for the fees page, Jane's
// answers and its tools: the holdings, and fee transactions from the last 12 months.

const YEAR_MS = 365 * 86_400_000;

export async function loadFees(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    investments: loaded,
  }: { client?: PrismaClient; now?: Date; investments?: Investments } = {},
): Promise<{ investments: Investments; fees: FeeSummary }> {
  const [investments, rows] = await Promise.all([
    loaded ?? loadInvestments(userId, { client, now }),
    scopedFor(userId, client).investmentTransactions.findMany({
      where: {
        date: { gt: new Date(now.getTime() - YEAR_MS), lte: now },
        subtype: { in: [...ADVISORY_FEE_SUBTYPES, ...ACCOUNT_FEE_SUBTYPES] },
      },
      select: { accountId: true, amountCents: true, subtype: true },
    }),
  ]);
  return { investments, fees: feeSummary(investments.accounts, rows) };
}
