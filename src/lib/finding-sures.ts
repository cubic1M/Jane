import type { PrismaClient } from "@/generated/prisma/client";
import { isoDay } from "@/lib/dates";
import { db as defaultClient } from "@/lib/db";
import type { ScopedDb } from "@/lib/db-scoped";
import { statementsReach } from "@/lib/data-reach";
import type { SuggestionSure } from "@/lib/report-state";
import { timezoneOf, todayOf } from "@/lib/today";
import { monthsCovered } from "@/profile/build";

// What a finding's "% sure" is worked out from (findingSure in ./report-state.ts), read as /report
// reads it: the scan's own confidence on each topic, the newest first, and the months of data Jane
// has read, counted as the profile counts them: on the person's day, to where the statements
// reach (gate C, 11-16: UTC's day and an upload counted to today moved "N months" by itself).
export async function findingSureFacts(
  db: Pick<ScopedDb, "suggestions" | "transactions" | "userId">,
  now: Date,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<{ sures: SuggestionSure[]; months: number }> {
  const [sures, read, today, timezone] = await Promise.all([
    db.suggestions.findMany({
      select: { topic: true, confidencePercent: true, confidenceReason: true },
      orderBy: { lastSeenAt: "desc" },
    }),
    db.transactions.aggregate({ _min: { date: true } }),
    todayOf(db.userId, { client, now }),
    timezoneOf(db.userId, { client }),
  ]);
  const months = read._min.date
    ? monthsCovered(isoDay(read._min.date), await statementsReach(db, today, timezone))
    : 0;
  return { sures, months };
}
