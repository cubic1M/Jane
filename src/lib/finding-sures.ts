import { isoDay } from "@/lib/dates";
import type { ScopedDb } from "@/lib/db-scoped";
import type { SuggestionSure } from "@/lib/report-state";
import { monthsCovered, statementsEnd } from "@/profile/build";

// What a finding's "% sure" is worked out from (findingSure in ./report-state.ts), read as /report
// reads it: the scan's own confidence on each topic, the newest first, and the months of data Jane
// has read, counted as the profile counts them.
export async function findingSureFacts(
  db: Pick<ScopedDb, "suggestions" | "transactions">,
  now: Date,
): Promise<{ sures: SuggestionSure[]; months: number }> {
  const [sures, read] = await Promise.all([
    db.suggestions.findMany({
      select: { topic: true, confidencePercent: true, confidenceReason: true },
      orderBy: { lastSeenAt: "desc" },
    }),
    db.transactions.aggregate({ _min: { date: true }, _max: { date: true } }),
  ]);
  const months =
    read._min.date && read._max.date
      ? monthsCovered(isoDay(read._min.date), statementsEnd(isoDay(read._max.date), isoDay(now)))
      : 0;
  return { sures, months };
}
