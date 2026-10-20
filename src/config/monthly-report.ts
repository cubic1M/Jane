// The monthly money report (spec step 148): made once per person for the month just ended,
// in the first days of the next, and posted in the chat and emailed.

// Made (and emailed) within this many days of the month's start, in the person's own time.
export const MONTHLY_REPORT_DAYS = 7;
// Payments toward cards and loans: money out in this Plaid category.
export const DEBT_PAYMENT_PRIMARY = "LOAN_PAYMENTS";
// At most this many receipts in the chat message; the rest are on the page.
export const MONTHLY_REPORT_RECEIPTS = 3;
