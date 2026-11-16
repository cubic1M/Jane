import { isoDay } from "@/lib/dates";
import type { ScopedDb } from "@/lib/db-scoped";
import { statementsEnd } from "@/profile/build";

// Where a person's data reaches, to count a window back from (gate C's calendar sweep, 11-15):
// today while their newest line is recent, a few days past it once it's old (statementsEnd). A
// year counted back from today instead lost a day of an old upload's history every day it sat:
// "11 gym payments in 11 months of data" became 10, the pay read from it crept up, and every
// figure built on it moved, with nothing new in the data.
export async function dataReach(
  db: Pick<ScopedDb, "transactions">,
  today: string,
): Promise<string> {
  const newest = await db.transactions.findFirst({
    where: { date: { lte: new Date(`${today}T00:00:00Z`) } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return statementsEnd(newest ? isoDay(newest.date) : "", today);
}
