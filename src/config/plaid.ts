// Plaid settings in one place. Products: Transactions, plus Liabilities as an optional
// product from spec step 65 (read-only rates and payments for cards and loans).

// History requested when an account is first linked: the most Plaid allows (transactions.days_requested
// at /link/token/create, maximum 730, default 90: plaid.com/docs/api/link/#link-token-create-request-transactions,
// read 2026-11-28). It can't be raised for an Item that already has Transactions: Plaid's only way is
// /item/remove and a new link (plaid.com/docs/api/products/transactions/#transactions-sync-request-options-days-requested).
// Plaid bills Transactions per connected Item, not by days of history (the founder checks the price).
// Detection looks back 12 months and Plaid recommends at least 180 days for recurring streams.
export const TRANSACTION_DAYS_REQUESTED = 730;

// A bank linked in the last this many days is read again by the daily job even if it synced today:
// Plaid delivers 30 days first and the rest (INITIAL_UPDATE_COMPLETE, then HISTORICAL_UPDATE_COMPLETE:
// plaid.com/docs/transactions/webhooks/, read 2026-11-28) later, and a missed SYNC_UPDATES_AVAILABLE
// webhook must not leave a person at 30 days.
export const HISTORY_CATCH_UP_DAYS = 3;

// Transactions per /transactions/sync page (Plaid allows 1 to 500).
export const SYNC_PAGE_SIZE = 500;

// Times a sync restarts from its first page when Plaid's data changes mid-pagination.
export const SYNC_MAX_RESTARTS = 3;

// The daily job syncs items that haven't synced for this long. Webhooks are what keep items
// fresh (Plaid sends SYNC_UPDATES_AVAILABLE when there's something new); Vercel Hobby runs the
// job once a day, so this is the backstop for a missed webhook, under a day so an item synced
// a little after yesterday's run isn't skipped for two.
export const STALE_SYNC_HOURS = 20;

// A Plaid call that fails for a reason that passes (rate limits, an institution outage, Plaid's
// own errors, no answer) is tried this many times in all, waiting SYNC_RETRY_BASE_MS, then twice
// that, and so on, with up to a quarter more at random so retries don't line up.
export const SYNC_RETRY_ATTEMPTS = 3;
export const SYNC_RETRY_BASE_MS = 500;
// One Plaid call gets this long. Without it, an answer that never comes holds the daily job until
// the function is killed, and what runs after the banks (clean-up, retention) never runs.
export const PLAID_TIMEOUT_MS = 30_000;
// Plaid's error codes that a later try can clear (plaid.com/docs/errors).
export const RETRYABLE_PLAID_CODES: readonly string[] = [
  "RATE_LIMIT",
  "ACCOUNTS_LIMIT",
  "TRANSACTIONS_LIMIT",
  "TRANSACTIONS_SYNC_LIMIT",
  "INVESTMENTS_LIMIT",
  "LIABILITIES_LIMIT",
  "INSTITUTION_RATE_LIMIT",
  "INSTITUTION_DOWN",
  "INSTITUTION_NOT_RESPONDING",
  "INTERNAL_SERVER_ERROR",
  "PRODUCT_NOT_READY",
];
// Codes that mean the person has to sign in to their bank again (Link update mode).
export const SIGN_IN_PLAID_CODES: readonly string[] = [
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "USER_PERMISSION_REVOKED",
  "ACCESS_NOT_GRANTED",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "PASSWORD_RESET_REQUIRED",
];
// Update mode can't start for these: the Item is gone at Plaid (taken back at my.plaid.com, or
// removed). Plaid's docs: make a fresh Link instead, so the person is told to remove the bank and
// link it again.
export const ENDED_ITEM_PLAID_CODES: readonly string[] = [
  "ITEM_NOT_FOUND",
  "INVALID_ACCESS_TOKEN",
  "USER_PERMISSION_REVOKED",
];
// PENDING_DISCONNECT / PENDING_EXPIRATION without a time of their own: Plaid sends them this many
// days ahead.
export const PENDING_DISCONNECT_DAYS = 7;
// A webhook sync that started longer ago than this is taken to have died, and another may run.
export const SYNC_LOCK_MINUTES = 10;
// Handled webhooks are kept this long, for looking back.
export const WEBHOOK_EVENT_DAYS = 7;
// How long an identical body counts as Plaid repeating itself. Bodies have no id of their own: every
// SYNC_UPDATES_AVAILABLE for a bank reads the same, so a longer memory ignores real news. A little
// over WEBHOOK_MAX_AGE_SECONDS, past which a signed delivery is refused anyway.
export const WEBHOOK_REPEAT_MINUTES = 10;

// Items synced per daily job run, so one run stays well inside the function time limit.
export const CRON_SYNC_LIMIT = 25;
// And at most this long on them (debugger 11-01: a 504 at 10:18Z after #1103, the syncs having
// no clock): the rest, oldest first, wait for tomorrow's run (or a webhook before it).
export const CRON_SYNC_BUDGET_MS = 120_000;

// The nightly request as a whole (maxDuration is 300 s): past this no step starts and the one under
// way isn't waited for, so the run is still recorded.
export const CRON_REQUEST_BUDGET_MS = 270_000;
// Kept for the steps after the bank syncs: a sync still under way is waited for only until this much
// of the night is left.
export const CRON_AFTER_SYNC_RESERVE_MS = 120_000;
// The banks' least, when the work before them has already used into that: they aren't skipped.
export const CRON_SYNC_LEAST_MS = 20_000;

// Webhooks signed longer ago than this are rejected as possible replays (Plaid's advice).
export const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

// A forged webhook names any key id it likes, and each new one is a call to Plaid before the
// signature can be checked. Past this many a minute per server, an unknown id is refused without
// asking; Plaid sends a refused webhook again later.
export const WEBHOOK_KEY_LOOKUPS_PER_MINUTE = 30;
// A key we hold is asked about again after this long, since Plaid can retire one.
export const WEBHOOK_KEY_RECHECK_HOURS = 24;

// Rates above this from Plaid are treated as missing rather than shown: 100% a year.
export const MAX_APR_BPS = 10_000;

// A bank just linked: how often the first sync asks again while Plaid has nothing yet, and how many
// times. Plaid's webhook does it too, but a person is watching their first scan.
export const FIRST_SYNC_WAIT_MS = 10_000;
export const FIRST_SYNC_TRIES = 6;

// A webhook that came while a sync ran has that sync run again, this many times at most.
export const SYNC_AGAIN_MAX = 3;

// How far back a link is held to be (src/lib/plaid/history.ts). Links made before #2398 deployed
// asked Plaid for 365 days, later ones for TRANSACTION_DAYS_REQUESTED; the link's own day says which.
export const DAYS_REQUESTED_BEFORE_MAX = 365;
export const MAX_DAYS_REQUESTED_FROM = "2026-11-28T04:16:00Z";
// The oldest transaction may sit this many days after the first day asked for (a bank's first
// posted day, a weekend) and the link still counts as holding all that was asked.
export const HISTORY_SLACK_DAYS = 10;
// A link that is not complete at Plaid is read at every nightly run, whatever its last sync, until
// it is this many days old; past that it only shows as stuck on /admin/history.
export const HISTORY_CATCH_UP_MAX_DAYS = 45;
// A link is given this long before its history is judged short (Plaid's first pull and the older
// history arrive over minutes to hours: plaid.com/docs/transactions/webhooks/, read 2026-11-28).
export const HISTORY_GRACE_HOURS = 24;
// Without Plaid saying "complete", a short link is read again from the start once, after this many days.
export const HISTORY_RESCAN_AFTER_DAYS = 3;
// Plaid's last word on a link's history (/transactions/sync's transactions_update_status).
export const HISTORY_COMPLETE = "HISTORICAL_UPDATE_COMPLETE";

// A read from the start (the one re-read of a short link) removes the rows Plaid no longer lists
// (src/lib/plaid/reread-removals.ts). Normal churn is a charge reissued under a new id: a few rows.
// More POSTED rows than this many, or than this share of the link's rows (the larger bound
// applies), looks like Plaid sending a truncated set: nothing is removed, the saved cursor stays,
// and the link is flagged on /admin/history.
export const REREAD_MAX_POSTED_REMOVALS = 5;
export const REREAD_MAX_POSTED_SHARE = 0.02;

// One tap for the full history (src/lib/plaid/replace.ts): how long, in all, the new link's history is
// waited for (Plaid says it typically arrives within a minute or two, plaid.com/docs/transactions/webhooks/,
// read 2026-11-28), and how often it is looked at. Past it nothing is changed and the new link is removed.
export const REPLACE_WAIT_MS = 120_000;
export const REPLACE_WAIT_STEP_MS = 10_000;
// The whole replacement (the wait, the matching, the categories, the move) must end well inside the
// route's 300 s limit (src/app/api/plaid/full-history/route.ts): past this a replacement that has not
// reached the move is given up and the new link removed.
export const REPLACE_TOTAL_MS = 240_000;
// The new link is kept (hidden, status "replacing") from the moment it is made until the move. The
// nightly job removes one older than this, at Plaid and here: the function that made it is gone.
export const REPLACING_STALE_MS = 15 * 60_000;
// Statuses of a plaid_items row that is not a bank link the person has: a link made for a replacement
// that has not moved in yet ("replacing"), and the link a fuller one took over ("replaced"). Every list,
// count, sync and webhook treats them as not there.
export const HIDDEN_ITEM_STATUSES = ["replaced", "replacing"] as const;
// Charges the new read words differently (a rewritten name, a posted day that moved) still pair with the
// old row of the same account and amount when the days are this close.
export const TWIN_DATE_SLACK_DAYS = 3;
// A pending charge younger than this is never deleted by the move: the new link may not list it yet,
// and the later posted charge finds it again by its old id (pending_transaction_id).
export const STALE_PENDING_DAYS = 10;
// A posted charge the person holds is never deleted by the move. When the new read, inside the days it
// actually returned, has no twin for one, the move refuses before writing anything.
// Margin kept for the commit and the removal at Plaid after the categories are asked for.
export const REPLACE_COMMIT_MARGIN_MS = 30_000;
// A kept pending row meets its posted charge (same account and amount, the only candidate) within this many days.
export const LEGACY_POSTED_DAYS = 10;
// After a refusal (plaid_history_refused) the tap is not offered for this many days for that link: each
// tap makes a billed Item, and a hole in the new read does not close by trying again at once.
export const REFUSAL_WAIT_DAYS = 7;
// The nightly job raises an ops event when a hidden link has failed to be removed at Plaid this many nights.
export const REMOVAL_FAILURES_BEFORE_ALERT = 3;
