import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { log } from "@/lib/log";
import { systemDb } from "@/lib/system-db";

// How landing-page tries with someone's own statement went (founder 11-04): a total per day and
// event, on /admin/reports. Only counts: no id, no file, nothing that could point back to a person,
// so they stay after a try is deleted. Not analytics: nothing here is about anyone.

const TRY_EVENTS = {
  started: "Tries started",
  scan_finished: "Scans finished",
  scan_failed: "Scans failed",
  needs_columns: "Sent to pick columns",
  unreadable: "Files Jane couldn't read",
  no_rows: "Files with no transactions",
  too_many_rows: "Files with too many rows",
  busy: "Turned away at the daily limit",
  failed_start: "Tries that couldn't start",
} as const;
export type TryEvent = keyof typeof TRY_EVENTS;

const WHY = "Daily totals of tries: no person and no statement in them";
const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (date: Date) => date.toISOString().slice(0, 10);

// A count must never cost someone their try.
export async function countTry(
  event: TryEvent,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<void> {
  try {
    await systemDb(WHY, client).$executeRaw`
      INSERT INTO try_stats (day, event, count) VALUES (${utcDay(now)}::date, ${event}, 1)
      ON CONFLICT (day, event) DO UPDATE SET count = try_stats.count + 1`;
  } catch (error) {
    log.error("Counting a try failed", { error: error instanceof Error ? error.name : "unknown" });
  }
}

export type TryTotal = { event: TryEvent; label: string; lastWeek: number; allTime: number };

// Every event, in order, zero when nothing has happened, for the last 7 UTC days and all time.
export async function tryTotals({
  client = defaultClient,
  now = new Date(),
}: { client?: PrismaClient; now?: Date } = {}): Promise<TryTotal[]> {
  const rows = await systemDb(WHY, client).tryStat.findMany();
  const since = utcDay(new Date(now.getTime() - 6 * DAY_MS));
  return (Object.keys(TRY_EVENTS) as TryEvent[]).map((event) => {
    const mine = rows.filter((r) => r.event === event);
    return {
      event,
      label: TRY_EVENTS[event],
      lastWeek: mine.filter((r) => utcDay(r.day) >= since).reduce((sum, r) => sum + r.count, 0),
      allTime: mine.reduce((sum, r) => sum + r.count, 0),
    };
  });
}
