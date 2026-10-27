import { addDays } from "@/lib/dates";

// The same account's statement uploaded as a CSV and as OFX/QFX (round 6 of the new-user passes:
// a CSV for two months, then the bank's QFX for three). Their rows carry different keys (a CSV
// row's is a hash of what it says, an OFX row's the bank's id), so the database kept both and
// every transaction counted twice. A row whose twin from the other format is already there, or
// came earlier in the same upload, is dropped: same amount, the same day or one apart (a posting
// date beside a transaction date), and descriptions that agree (QFX cuts names at 32 letters).
// Each twin pairs once, so two real coffees stay two.

export type RowFacts = { key: string; date: string; amountCents: number; description: string };

const isOfx = (key: string) => key.startsWith("ofx:");

function sameWords(a: string, b: string): boolean {
  const x = a.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const y = b.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  // A cut name is the start of the full one; a shortened one is in it.
  return long.startsWith(short) || (short.length >= 6 && long.includes(short));
}

// The incoming rows' indexes to drop. Rows go in date order, each taking the earliest unused twin
// within a day either side: that pairs as many as can be, a whole file a day off included.
export function crossFormatTwins(existing: readonly RowFacts[], incoming: readonly RowFacts[]) {
  const pool = existing.map((row) => ({ row, used: false }));
  const drop = new Set<number>();
  const order = [...incoming.keys()].sort((a, b) =>
    incoming[a].date.localeCompare(incoming[b].date),
  );
  for (const i of order) {
    const row = incoming[i];
    const from = addDays(row.date, -1);
    const to = addDays(row.date, 1);
    const twin = pool
      .filter(
        (p) =>
          !p.used &&
          p.row.date >= from &&
          p.row.date <= to &&
          isOfx(p.row.key) !== isOfx(row.key) &&
          p.row.amountCents === row.amountCents &&
          sameWords(p.row.description, row.description),
      )
      .sort((a, b) => a.row.date.localeCompare(b.row.date))[0];
    if (twin) {
      twin.used = true;
      drop.add(i);
    } else {
      pool.push({ row, used: false });
    }
  }
  return drop;
}
