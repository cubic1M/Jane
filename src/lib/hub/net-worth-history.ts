import type { PrismaClient } from "@/generated/prisma/client";
import { dailyNetWorth, type SeriesPoint } from "@/insights/net-worth-series";
import { db as defaultClient } from "@/lib/db";
import { isoDay as day } from "@/lib/dates";
import { loadNetWorthInputs } from "@/lib/net-worth-history";
import { todayOf } from "@/lib/today";

// The home hub's net worth chart (docs/design/home-hub.md): net worth every day from the
// person's first day with Jane (their first account link, or their first balance if that's
// earlier, as a sample person's year of demo-bank balances is) to today. It ends at the hub's
// own headline figure, which the caller passes in, so the two never disagree; and it reads what
// the headline reads (loadNetWorthInputs), so a bank linked twice counts once on every day too,
// not only today (gate B: the line dropped by the copy's balance on its last day).

export async function netWorthHistory(
  userId: string,
  todayCents: number,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<SeriesPoint[]> {
  // The person's own day (src/lib/today.ts): at 7pm in Los Angeles UTC's date is tomorrow, and the
  // chart grew a point for a day that hadn't started (gate C's calendar sweep, 11-15).
  const [{ accounts, snapshots, owned, crypto }, asOf] = await Promise.all([
    loadNetWorthInputs(userId, { client }),
    todayOf(userId, { client, now }),
  ]);
  const firstDay = [
    ...accounts.map((a) => day(a.createdAt)),
    ...snapshots.map((s) => s.date),
  ].reduce((first, d) => (d < first ? d : first), asOf);
  return dailyNetWorth({
    accounts,
    snapshots,
    owned,
    cryptoCents: crypto,
    firstDay,
    asOf,
    todayCents,
  });
}
