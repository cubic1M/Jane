// The monthly money report (spec step 148): made once per person for the month just ended,
// in the first days of the next, and posted in the chat and emailed.

// Made (and emailed) within this many days of the month's start, in the person's own time.
export const MONTHLY_REPORT_DAYS = 7;
// Payments toward cards and loans: money out in this Plaid category.
export const DEBT_PAYMENT_PRIMARY = "LOAN_PAYMENTS";
// At most this many receipts in the chat message; the rest are on the page.
export const MONTHLY_REPORT_RECEIPTS = 3;
// The daily cron spends at most this long on them (debugger 11-01: on the 1st the digest cron
// timed out at 300 s, the reports first and unclocked); the rest wait for the next day's run,
// inside MONTHLY_REPORT_DAYS.
export const MONTHLY_REPORTS_CRON_BUDGET_MS = 90_000;
