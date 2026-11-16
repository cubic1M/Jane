import { profileHistoryStart } from "@/config/profile";
import { isoDay } from "@/lib/dates";
import { localDate } from "@/lib/today";
import type { ScopedDb } from "@/lib/db-scoped";
import { reachOf } from "@/profile/build";

// Where a person's data reaches, to count a window back from (gate C's calendar sweep, 11-15):
// a linked bank's today while its newest line is recent, an upload's its own last line (reachOf). A
// year counted back from today instead lost a day of an old upload's history every day it sat:
// "11 gym payments in 11 months of data" became 10, the pay read from it crept up, and every
// figure built on it moved, with nothing new in the data.
// `timezone` is the person's, for the day an upload came in.
export async function dataReach(
  db: Pick<ScopedDb, "transactions">,
  today: string,
  timezone: string,
): Promise<string> {
  // The newest line from a linked bank, and the newest from an upload with the day it came in.
  const newest = (uploaded: boolean) =>
    db.transactions.findFirst({
      where: {
        date: { lte: new Date(`${today}T00:00:00Z`) },
        source: uploaded ? "csv" : { not: "csv" },
      },
      orderBy: { date: "desc" },
      select: { date: true, createdAt: true },
    });
  const [bank, upload] = await Promise.all([newest(false), newest(true)]);
  const lines = [
    ...(bank ? [{ date: isoDay(bank.date) }] : []),
    ...(upload
      ? [{ date: isoDay(upload.date), uploadedOn: localDate(upload.createdAt, timezone) }]
      : []),
  ];
  const last = lines.reduce((max, l) => (l.date > max ? l.date : max), "");
  // Data all older than the year says nothing about now: counted from today, as before, and
  // none of it is in (the detection window's rule too: src/detection/helpers.ts lookbackEnd).
  if (last <= isoDay(profileHistoryStart(new Date(`${today}T00:00:00Z`)))) return today;
  return reachOf(lines, today);
}
