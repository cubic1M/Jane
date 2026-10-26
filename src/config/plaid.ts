// Plaid settings in one place. Products: Transactions, plus Liabilities as an optional
// product from spec step 65 (read-only rates and payments for cards and loans).

// History requested when an account is first linked. Detection looks back 12 months and
// Plaid recommends at least 180 days for recurring streams.
export const TRANSACTION_DAYS_REQUESTED = 365;

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
// A webhook sync that started longer ago than this is taken to have died, and another may run.
export const SYNC_LOCK_MINUTES = 10;
// Handled webhooks are remembered this long (Plaid retries a delivery for about a day).
export const WEBHOOK_EVENT_DAYS = 7;

// Items synced per daily job run, so one run stays well inside the function time limit.
export const CRON_SYNC_LIMIT = 25;

// Webhooks signed longer ago than this are rejected as possible replays (Plaid's advice).
export const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

// Rates above this from Plaid are treated as missing rather than shown: 100% a year.
export const MAX_APR_BPS = 10_000;
