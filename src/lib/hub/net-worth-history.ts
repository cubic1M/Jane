import type { PrismaClient } from "@/generated/prisma/client";
import { dailyNetWorth, type SeriesPoint } from "@/insights/net-worth-series";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The home hub's net worth chart (docs/design/home-hub.md): net worth every day from the
// person's first day with Jane (their first account link, or their first balance if that's
// earlier, as a sample person's year of demo-bank balances is) to today. It ends at the hub's
// own headline figure, which the caller passes in, so the two never disagree.

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function netWorthHistory(
  userId: string,
  todayCents: number,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<SeriesPoint[]> {
  const db = scopedFor(userId, client);
  const [accounts, snapshots, owned, crypto] = await Promise.all([
    db.accounts.findMany({
      select: { id: true, type: true, currentBalanceCents: true, createdAt: true },
    }),
    db.balanceSnapshots.findMany({ select: { accountId: true, date: true, balanceCents: true } }),
    db.ownedAssets.findMany({ select: { id: true, valueCents: true, valuedOn: true } }),
    cryptoTotal(userId, { client }),
  ]);
  const asOf = day(now);
  const firstDay = [
    ...accounts.map((a) => day(a.createdAt)),
    ...snapshots.map((s) => day(s.date)),
  ].reduce((first, d) => (d < first ? d : first), asOf);
  return dailyNetWorth({
    accounts,
    snapshots: snapshots.map((s) => ({ ...s, date: day(s.date) })),
    owned: owned.map((o) => ({ ...o, valuedOn: day(o.valuedOn) })),
    cryptoCents: crypto,
    firstDay,
    asOf,
    todayCents,
  });
}
