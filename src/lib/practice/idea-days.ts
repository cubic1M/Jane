import { PRACTICE_IDEA_DAYS } from "@/config/practice-suggestions";
import { addDays, DAY_MS } from "@/lib/dates";
import { localDate } from "@/lib/today";

// A practice idea waits PRACTICE_IDEA_DAYS of the person's own days: through the day it was found
// and the seven after, as the rule replay counts them (src/planning/rule-replay.ts). Counted from
// the hour (gate C's calendar sweep, 11-16), one found at the 21:30 UTC close lapsed at 2:30pm in
// Los Angeles a week on, so the morning's scan kept it and the 7pm scan put it away.
export const stillWaiting = (scannedAt: Date, today: string, timezone: string): boolean =>
  localDate(scannedAt, timezone) >= addDays(today, -PRACTICE_IDEA_DAYS);

// A bound for the query, wide enough for any timezone; stillWaiting decides.
export const waitingBound = (now: Date): Date =>
  new Date(now.getTime() - (PRACTICE_IDEA_DAYS + 2) * DAY_MS);
