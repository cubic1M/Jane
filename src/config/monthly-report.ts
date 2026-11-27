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

// A report a run took to email but did not finish (it stopped between the claim and the send) is taken
// over by the next run after this long. The send carries a key of the report's id, so asking again
// cannot make a second email.
export const MONTHLY_REPORT_CLAIM_MS = 30 * 60 * 1000;
