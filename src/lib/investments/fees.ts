import { ACCOUNT_FEE_SUBTYPES, ADVISORY_FEE_SUBTYPES } from "@/config/market-assumptions";
import type { PrismaClient } from "@/generated/prisma/client";
import { feeSummary, type FeeSummary } from "@/insights/investment-fees";
import { db as defaultClient } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { scopedFor } from "@/lib/db-scoped";
import { todayOf } from "@/lib/today";
import { loadInvestments, type Investments } from "./holdings";

// What investing costs the person (spec step 130), loaded for the fees page, Jane's
// answers and its tools: the holdings, and fee transactions from the last 12 months.

// The last 12 months are the person's days: a fee is a day (a date at UTC midnight), so a window cut
// at this instant a year ago dropped a quarter's fee at 7pm in Los Angeles and kept it at 3pm (the
// calendar sweep, 12-30: "$738.54" at 3pm, "$694.84" at 7pm, for the demo person).
const YEAR_DAYS = 365;

export async function loadFees(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    investments: loaded,
  }: { client?: PrismaClient; now?: Date; investments?: Investments } = {},
): Promise<{ investments: Investments; fees: FeeSummary }> {
  const today = await todayOf(userId, { client, now });
  const [investments, rows] = await Promise.all([
    loaded ?? loadInvestments(userId, { client, now }),
    scopedFor(userId, client).investmentTransactions.findMany({
      where: {
        date: {
          gt: new Date(`${addDays(today, -YEAR_DAYS)}T00:00:00Z`),
          lte: new Date(`${today}T00:00:00Z`),
        },
        subtype: { in: [...ADVISORY_FEE_SUBTYPES, ...ACCOUNT_FEE_SUBTYPES] },
      },
      select: { accountId: true, amountCents: true, subtype: true },
    }),
  ]);
  return { investments, fees: feeSummary(investments.accounts, rows) };
}
