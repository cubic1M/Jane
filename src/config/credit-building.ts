// Building credit (spec step 175): paying before a card's statement closes so a lower
// balance is reported, the on-time streak, a credit-builder stand-in for thin files, and
// the score simulator.

// Jane looks at a card's coming statement this many days before it closes, and pays this
// many days before, so the payment has posted when the balance is reported.
export const STATEMENT_LEAD_DAYS = 6;
export const STATEMENT_PAY_DAYS_BEFORE = 2;
// What checking keeps after a payment before the statement closes.
export const STATEMENT_CUSHION_CENTS = 50_000;

// On-time streaks Jane says well done for, in months.
export const STREAK_MILESTONES: readonly number[] = [3, 6, 12];
// How far back Jane looks for late fees and overdue payments.
export const STREAK_LOOKBACK_DAYS = 365;

// A thin file: fewer credit accounts than this, or accounts younger than this on average.
export const THIN_FILE_ACCOUNTS = 3;
export const THIN_FILE_AGE_MONTHS = 24;

// The score simulator's new card, for "what if I open a card?": a typical first limit.
export const SIMULATED_NEW_CARD_LIMIT_CENTS = 500_000;

// Where the rules about what moves a score come from, for the page.
export const CREDIT_SCORE_SOURCE =
  "https://www.consumerfinance.gov/ask-cfpb/what-is-a-credit-score-en-315/";
