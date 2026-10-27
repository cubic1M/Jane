import type { DayBalance } from "@/data-sources/csv/csv-source";
import type { ScopedDb } from "@/lib/db-scoped";
import { isoDay } from "@/lib/dates";

// Balances over time for uploaded accounts, so net worth on /home and /net-worth isn't a flat
// line at today's balance (founder: "the graphs are flat straight lines"). Plaid syncs write
// balance snapshots; an upload writes its own: each day's closing balance from the statement's
// running-balance column ("file"), else month ends worked back from the account's balance today
// by undoing the transactions after each one ("derived"). Card balances are what's owed, as
// everywhere (net worth subtracts them), so a purchase raises them.

export const FILE_SOURCE = "file";
export const DERIVED_SOURCE = "derived";
// A balance the person typed (a new account's, or the answer to "what's in it today?"), as of
// the day they gave it.
export const GIVEN_SOURCE = "given";

const dayDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

// The last day of each month from the first transaction's month before (the opening balance)
// up to the month before today's, then today.
// And every day money moved before today, so the line steps on each of them, not straight between
// month ends (founder: "the graph doesn't show every single movement of the money").
function snapshotDays(first: string, today: string, moved: readonly string[] = []): string[] {
  const days: string[] = [];
  const [year, month] = first.split("-").map(Number);
  // The end of the month before the first transaction: the balance before any of them.
  let end = new Date(Date.UTC(year, month - 1, 0));
  while (isoDay(end) < today.slice(0, 7) + "-01") {
    days.push(isoDay(end));
    end = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 2, 0));
  }
  days.push(today);
  return [...new Set([...days, ...moved.filter((d) => d < today)])].sort();
}

// An account's balance at the end of each snapshot day, worked back from today's. With the
// statement's own balances (`anchors`), each day is worked from the nearest of them instead: back
// from the next one after it, else forward from the last one before it. A gap in the rows then
// stays a gap (round 8 of the new-user passes: after the newer of two uploads was removed, the
// older months were worked back from today's balance across 45 missing days, and June read
// $5,491 where the file said $1,000).
export function derivedBalances(
  type: string,
  currentCents: number,
  transactions: readonly { date: string; amountCents: number }[],
  today: string,
  anchors: readonly DayBalance[] = [],
): DayBalance[] {
  if (transactions.length === 0) return [{ date: today, balanceCents: currentCents }];
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const marks = [...anchors].sort((a, b) => a.date.localeCompare(b.date));
  // Money out is positive: it lowered a bank balance and raised what's owed on a card.
  const sign = type === "credit" ? -1 : 1;
  const between = (from: string, to: string) =>
    sorted.filter((t) => t.date > from && t.date <= to).reduce((sum, t) => sum + t.amountCents, 0);
  const moved = sorted.map((t) => t.date);
  return snapshotDays(sorted[0].date, today, moved).map((date) => {
    if (date === today) return { date, balanceCents: currentCents };
    const next = marks.find((m) => m.date > date);
    if (next) return { date, balanceCents: next.balanceCents + sign * between(date, next.date) };
    const last = marks.findLast((m) => m.date <= date);
    if (last) return { date, balanceCents: last.balanceCents - sign * between(last.date, date) };
    return { date, balanceCents: currentCents + sign * between(date, "9999-12-31") };
  });
}

// The statement's own closing balances, replacing whatever was kept for those days. The latest
// becomes the account's balance today unless a newer one is known: one a later statement gave,
// or one the person typed since. (Founder: the headline stayed at the first file's balance when
// months were uploaded oldest first, so Home was months stale and the line jumped at today.)
export async function keepFileBalances(
  db: Pick<ScopedDb, "userId" | "balanceSnapshots" | "accounts">,
  accountId: string,
  balances: readonly DayBalance[],
): Promise<number> {
  if (balances.length === 0) return 0;
  const known = await db.balanceSnapshots.findFirst({
    where: { accountId, source: { in: [FILE_SOURCE, GIVEN_SOURCE] } },
    orderBy: { date: "desc" },
    select: { date: true, source: true },
  });
  const dates = balances.map((b) => dayDate(b.date));
  await db.balanceSnapshots.deleteMany({ where: { accountId, date: { in: dates } } });
  const { count } = await db.balanceSnapshots.createMany({
    data: balances.map((b) => ({
      userId: db.userId,
      accountId,
      date: dayDate(b.date),
      balanceCents: b.balanceCents,
      source: FILE_SOURCE,
    })),
    skipDuplicates: true,
  });
  const latest = balances.reduce((a, b) => (b.date > a.date ? b : a));
  const knownDay = known ? isoDay(known.date) : null;
  const newer =
    knownDay === null ||
    latest.date > knownDay ||
    (latest.date === knownDay && known?.source === FILE_SOURCE);
  await db.accounts.updateMany({
    where: newer ? { id: accountId } : { id: accountId, currentBalanceCents: null },
    data: { currentBalanceCents: latest.balanceCents },
  });
  return count;
}

// A balance the person typed, kept as of the day they gave it: a later upload's balance replaces
// it as today's only when the statement runs past that day.
export async function keepGivenBalance(
  db: Pick<ScopedDb, "userId" | "balanceSnapshots">,
  accountId: string,
  cents: number,
  now: Date = new Date(),
): Promise<void> {
  const date = dayDate(isoDay(now));
  await db.balanceSnapshots.upsert({
    where: { accountId_date: { accountId, date } },
    create: { userId: db.userId, accountId, date, balanceCents: cents, source: GIVEN_SOURCE },
    update: { balanceCents: cents, source: GIVEN_SOURCE },
  });
}

// Every uploaded account's worked-back balances, made again from what's stored now (after an
// upload, and after one is removed). Days the statement gave a balance for keep that one.
export async function rebuildUploadedBalances(
  db: Pick<ScopedDb, "userId" | "balanceSnapshots" | "accounts" | "transactions">,
  now: Date = new Date(),
): Promise<number> {
  const today = isoDay(now);
  const accounts = await db.accounts.findMany({
    where: { source: "csv", currentBalanceCents: { not: null } },
    select: { id: true, type: true, currentBalanceCents: true },
  });
  let saved = 0;
  for (const account of accounts) {
    // Worked-back days are made again; the daily copies of today's balance (no source) say nothing
    // the statements don't, and held a stale balance on the days since a newer statement came.
    await db.balanceSnapshots.deleteMany({
      where: {
        accountId: account.id,
        OR: [{ source: DERIVED_SOURCE }, { source: null, date: { lt: dayDate(today) } }],
      },
    });
    const [fromFile, rows] = await Promise.all([
      db.balanceSnapshots.findMany({
        // The statement's own balances, and the person's: both are what the account held.
        where: { accountId: account.id, source: { in: [FILE_SOURCE, GIVEN_SOURCE] } },
        select: { date: true, balanceCents: true },
      }),
      db.transactions.findMany({
        where: { accountId: account.id },
        select: { date: true, amountCents: true },
      }),
    ]);
    const fileDays = new Set(fromFile.map((s) => isoDay(s.date)));
    // Month ends worked back from today; a day the statement gave its own balance for keeps it
    // (an OFX file has one, a Chase export one a day).
    const balances = derivedBalances(
      account.type,
      account.currentBalanceCents ?? 0,
      rows.map((r) => ({ date: isoDay(r.date), amountCents: r.amountCents })),
      today,
      fromFile.map((s) => ({ date: isoDay(s.date), balanceCents: s.balanceCents })),
    ).filter((b) => !fileDays.has(b.date));
    const { count } = await db.balanceSnapshots.createMany({
      data: balances.map((b) => ({
        userId: db.userId,
        accountId: account.id,
        date: dayDate(b.date),
        balanceCents: b.balanceCents,
        source: DERIVED_SOURCE,
      })),
      // Today's daily snapshot, if it's already been taken, stays.
      skipDuplicates: true,
    });
    saved += count;
  }
  return saved;
}
