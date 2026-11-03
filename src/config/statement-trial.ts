// Try Jane with your own statement: anyone can upload a bank statement from the landing page,
// with no email, and see Jane work on their own numbers in a temporary person
// (src/lib/statement-trial.ts). No sign-up means anyone can spend the shared Anthropic budget,
// so every limit lives here.

import { TRIAL_HOURS } from "./trial";

// One statement a request, and what one temporary person may hold. Three months of a busy
// checking account is a few hundred rows and well under 100 KB.
export const STATEMENT_TRIAL_MAX_FILE_BYTES = 1024 * 1024;
export const STATEMENT_TRIAL_MAX_ROWS = 3_000;
export const STATEMENT_TRIAL_MAX_PERSON_ROWS = 6_000;
export const STATEMENT_TRIAL_MAX_UPLOADS = 10;

// Answers Claude writes for one temporary person, in all (rate limit "claudeStatementTrial"), and
// what they may cost that person in a day. Typing past the count gets STATEMENT_TRIAL_CAP_TEXT.
export const STATEMENT_TRIAL_CHAT_ANSWERS = 10;
export const STATEMENT_TRIAL_PERSON_CAP_CENTS = 30;

// What Claude may cost for all temporary people together in a UTC day. Past it they get the
// answer from their data, no Claude. Sample people's limits apply too: all trial people stop at
// CHAT_TRIAL_MONTH_SHARE of the chat's monthly guard. STATEMENT_TRIAL_DAILY_CENTS overrides it; 0
// turns Claude off for this path.
export const STATEMENT_TRIAL_DAILY_CENTS_DEFAULT = 20;

// Taken from the day's allowance when an answer starts and given back when it ends, so answers
// started at the same moment can't all pass a check that none of them has paid for yet: at most
// DAILY / RESERVE run at once.
export const STATEMENT_TRIAL_RESERVE_CENTS = 5;

// A temporary person's session ends after TRIAL_HOURS. The clean-up runs once a day and takes those
// past that age, so they go within a day of it, and one late or failed night adds a day: the words on
// the banner and the legal pages use this, so they can't promise less than the clean-up can keep.
export const TRIAL_DELETED_WITHIN_HOURS = TRIAL_HOURS + 48;

// How long one clean-up may spend on people who won't delete, before leaving the rest for the next
// run: it comes before a night's work for everyone else, and the cron has a limit
// (src/app/api/cron/plaid-sync).
export const TRIAL_CLEANUP_BUDGET_MS = 60_000;
// A step still running when its person goes writes within minutes; this far back covers a missed night.
export const TRIAL_SWEEP_LOOKBACK_DAYS = 3;

export const STATEMENT_TRIAL_BUSY =
  "So many people are trying Jane today that this has to wait. Please come back tomorrow, or try it with sample data.";
export const STATEMENT_TRIAL_TOO_MANY =
  "Lots of people are trying Jane from here. Please try again in an hour.";

export const STATEMENT_TRIAL_CAP_TEXT = `You've used the ${STATEMENT_TRIAL_CHAT_ANSWERS} written answers a temporary try gets. Everything Jane found on your statement is still on your pages.`;

// A job on the upload's own server can't run past the 300-second limit on / and /import: past this
// it's lost, and goes again. After this many tries it's called failed.
export const STATEMENT_TRIAL_STUCK_MINUTES = 6;
export const STATEMENT_TRIAL_STUCK_ATTEMPTS = 2;

export const STATEMENT_TRIAL_TURNED_OFF =
  "Trying Jane with your own statement is turned off for now. Nothing new can be added here.";

export const statementTooBig = () =>
  `A temporary try reads statements up to ${STATEMENT_TRIAL_MAX_FILE_BYTES / 1024 / 1024} MB. Download fewer months from your bank.`;
export const statementTooManyRows = () =>
  `A temporary try reads up to ${STATEMENT_TRIAL_MAX_ROWS.toLocaleString("en-US")} transactions at a time. Download fewer months from your bank.`;

// Words for what this path doesn't do.
export const STATEMENT_TRIAL_NO_DOCUMENTS =
  "A temporary try reads bank statements only, so documents aren't kept here.";
export const STATEMENT_TRIAL_NO_HOUSEHOLD = "A temporary try can't share a household.";
