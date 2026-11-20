import { ACCOUNT_FEE_SUBTYPES, ADVISORY_FEE_SUBTYPES } from "@/config/market-assumptions";
import type { PrismaClient } from "@/generated/prisma/client";
import { feeSummary, type FeeSummary } from "@/insights/investment-fees";
import { db as defaultClient } from "@/lib/db";
import { addDays, daysBetween } from "@/lib/dates";
import { scopedFor } from "@/lib/db-scoped";
import { todayOf } from "@/lib/today";
import { STALE_AFTER_DAYS } from "@/profile/build";
import { oneYearOf } from "./fee-year";
import { loadInvestments, type Investments } from "./holdings";

// What investing costs the person (spec step 130), loaded for the fees page, Jane's
// answers and its tools: the holdings, and fee transactions from the last 12 months.

// The last 12 months are the person's days: a fee is a day (a date at UTC midnight), so a window cut
// at this instant a year ago dropped a quarter's fee at 7pm in Los Angeles and kept it at 3pm (the
// calendar sweep, 12-30: "$738.54" at 3pm, "$694.84" at 7pm, for the demo person). And they end at
// the newest investment line, not today: over data that stopped coming in, a year back from today
// dropped a quarter's fee with no new one to replace it (the sweep, 12-31: $738.54 to $694.84 with
// nothing new; car cover's year, #2133). Each fee on a cadence counts once a year (./fee-year.ts).
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
  const lines = scopedFor(userId, client).investmentTransactions;
  const newest = await lines.findFirst({
    where: { date: { lte: new Date(`${today}T00:00:00Z`) } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const end = newest ? newest.date.toISOString().slice(0, 10) : today;
  const [investments, rows] = await Promise.all([
    loaded ?? loadInvestments(userId, { client, now }),
    lines.findMany({
      where: {
        date: {
          gt: new Date(`${addDays(end, -YEAR_DAYS)}T00:00:00Z`),
          lte: new Date(`${end}T00:00:00Z`),
        },
        subtype: { in: [...ADVISORY_FEE_SUBTYPES, ...ACCOUNT_FEE_SUBTYPES] },
      },
      select: { accountId: true, amountCents: true, subtype: true, date: true },
    }),
  ]);
  const year = oneYearOf(rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) })));
  // Said as the year to its end day when that's long ago, not "the last 12 months" (feeYear).
  const yearTo = daysBetween(end, today) > STALE_AFTER_DAYS ? end : null;
  return { investments, fees: { ...feeSummary(investments.accounts, year), yearTo } };
}
