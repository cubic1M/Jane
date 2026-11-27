// The daily report email (src/lib/daily-report/): what it shows and when it speaks up. The
// thresholds live here, never inline.

// The daily report's own window: from this local hour up to (not including) the next, 7am to 8pm in
// the person's own timezone. The chat's quiet hours (9pm to 8am, src/config/agent-chat.ts) stay as they
// are for chat emails; the report is not held to them, so a run at 15:00 UTC reaches Los Angeles in
// winter (7am).
export const DAILY_REPORT_FROM_HOUR = 7;
export const DAILY_REPORT_UNTIL_HOUR = 20;

// The report gets this much of the cron's time at most, and never more than what is left after the
// reserve the jobs behind it need (src/config/controller.ts CONTROLLER_RUN_RESERVE_MS). A person not
// reached in time is left unclaimed, so the next run takes them.
export const DAILY_REPORTS_CRON_BUDGET_MS = 90_000;

// Changes already listed in a report are remembered this long, so each is said once.
export const DAILY_REPORT_CHANGE_MEMORY_DAYS = 30;

// Yesterday's biggest purchases listed by name.
export const DAILY_REPORT_LARGEST = 3;

// A bank often posts a charge a day or two after its date. A line that arrived since the last report
// with a date before yesterday is listed as "posted since", if it is dated within this many days
// before yesterday: older ones are history, not news. Linked banks only: an upload brings a whole
// statement at once.
export const DAILY_REPORT_LATE_DAYS = 7;

// "A usual day" is the middle (median) of the days with spending in the last DAILY_REPORT_USUAL_DAYS,
// said only with at least DAILY_REPORT_USUAL_MIN_DAYS of them behind it. Yesterday is unusual when it
// is at least DAILY_REPORT_UNUSUAL_MULTIPLE times that and at least DAILY_REPORT_UNUSUAL_MIN_CENTS
// above it: a small day is never news.
export const DAILY_REPORT_USUAL_DAYS = 56;
export const DAILY_REPORT_USUAL_MIN_DAYS = 14;
export const DAILY_REPORT_UNUSUAL_MULTIPLE = 2.5;
export const DAILY_REPORT_UNUSUAL_MIN_CENTS = 3_000;
// Whole months of transactions to read to cover those days (src/insights/load.ts).
export const DAILY_REPORT_MONTHS = 3;

// Suggestions listed, the surest and biggest first; the rest are "and N more" behind one link.
export const DAILY_REPORT_MAX_SUGGESTIONS = 3;
// Changes Jane noticed and alerts raised since the last report, listed at most this many in all.
export const DAILY_REPORT_MAX_HEADS_UP = 5;
// How many alerts and changes are read as candidates: a sentence the guardrails leave out must not
// use up one of the places above, so more are read than are listed (the builder checks, then cuts).
export const DAILY_REPORT_HEADS_UP_CANDIDATES = 20;
// The first report looks back this far for alerts and changes (later ones, to the last report).
export const DAILY_REPORT_FIRST_LOOKBACK_DAYS = 2;

// Bills, paydays and deadlines in the next few days, soonest first.
export const DAILY_REPORT_AHEAD_DAYS = 5;
export const DAILY_REPORT_AHEAD_LIMIT = 5;

// Added to every link in the report, so analytics can attribute visits.
export const DAILY_REPORT_UTM = {
  utm_source: "digest",
  utm_medium: "email",
  utm_campaign: "daily",
};
