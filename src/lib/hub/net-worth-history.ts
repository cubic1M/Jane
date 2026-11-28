import type { PrismaClient } from "@/generated/prisma/client";
import { dailyNetWorth, type SeriesPoint } from "@/insights/net-worth-series";
import { db as defaultClient } from "@/lib/db";
import { isoDay as day } from "@/lib/dates";
import { loadNetWorthInputs } from "@/lib/net-worth-history";
import { dayLabel } from "@/lib/day-label";
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
  options: { client?: PrismaClient; now?: Date } = {},
): Promise<SeriesPoint[]> {
  return (await netWorthHistoryWithNote(userId, todayCents, options)).points;
}

// What is carried flat before it was first known, said under the chart: bank and card balances are
// worked back from their transactions (src/lib/plaid/past-balances.ts), but investments and loans
// have no transactions to work back from, so they stand at their first known value, never invented.
const FLAT_KINDS: [string, (type: string) => boolean][] = [
  ["investments", (t) => t === "investment"],
  ["loans", (t) => t === "loan"],
  ["other accounts", (t) => !["depository", "credit", "investment", "loan"].includes(t)],
];

export async function netWorthHistoryWithNote(
  userId: string,
  todayCents: number,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<{ points: SeriesPoint[]; flatNote: string | null }> {
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
  const points = dailyNetWorth({
    accounts,
    snapshots,
    owned,
    cryptoCents: crypto,
    firstDay,
    asOf,
    todayCents,
  });
  // The first day each flat kind has a value of its own; the line starts before it.
  const known = (id: string, created: Date) =>
    [day(created), ...snapshots.filter((s) => s.accountId === id).map((s) => s.date)].reduce(
      (first, d) => (d < first ? d : first),
    );
  const flat = FLAT_KINDS.flatMap(([words, is]) => {
    const from = accounts
      .filter((a) => is(a.type) && a.currentBalanceCents !== null)
      .map((a) => known(a.id, a.createdAt))
      .sort()[0];
    return from && points[0] && points[0].date < from ? [{ words, from }] : [];
  });
  const first = flat.map((f) => f.from).sort()[0];
  return {
    points,
    flatNote: first
      ? `Before ${dayLabel(first, { year: true })}, ${flat.map((f) => f.words).join(" and ")} are shown at their first known value.`
      : null,
  };
}
