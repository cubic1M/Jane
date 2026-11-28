// Which year a federal tax payment counts toward (T7). The dates are month-day strings, compared
// with a payment's own calendar date (never the UTC clock).
//
// Source: IRS Publication 505 (2026), "When To Pay Estimated Tax", https://www.irs.gov/publications/p505,
// tax year 2026, read 2026-11-28: payment periods Jan. 1 - Mar. 31, Apr. 1 - May 31, Jun. 1 - Aug. 31
// are due April 15, June 15 and September 15 of the year; Sept. 1 - Dec. 31 is due Jan. 15 of the
// next year (Jan. 15, 2027 for 2026). "January payment": a person who files the return by January 31
// and pays the rest of the tax owed with it does not need the January 15 payment, so a payment made
// January 16-31 still goes to the year just ended. The Saturday, Sunday and holiday rule moves a due
// date to the next business day (a payment a day or two after the 15th is on time).
export const TAX_PAYMENT_WINDOW = {
  // First estimate of the year: paid from February 1 (January's is the last one of the year before)...
  yearFrom: "02-01",
  // ...a payment up to the first due date may be the year before's balance due instead.
  firstEstimateDue: "04-15",
  // The fourth installment's due date, in the next January.
  fourthDue: "01-15",
  // Last day of the next January that still counts for the year (balance paid with an early return).
  nextYearTo: "01-31",
  // The year before's estimates: its second, third and fourth installments (paid from June 1 of
  // that year to January 31 of this one). Its April payment is the one that may be a balance.
  priorEstimatesFrom: "06-01",
} as const;
