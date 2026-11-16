import { RESELECT_AFTER_DAYS } from "@/config/suggestions";
import { DAY_MS } from "@/lib/dates";

// The scan picks on the person's own day (src/lib/today.ts), kept as that day at midnight UTC in
// selectedOn, and a pick lasts RESELECT_AFTER_DAYS of their days, today included: the earliest
// selectedOn still counted. Days, not hours since: counted in milliseconds a pick lapsed at 7pm in
// Los Angeles a day before it did at 3pm (gate C).
export const picksSince = (today: string): Date =>
  new Date(Date.parse(`${today}T00:00:00Z`) - (RESELECT_AFTER_DAYS - 1) * DAY_MS);
