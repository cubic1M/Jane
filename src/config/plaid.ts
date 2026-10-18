// Plaid settings in one place. Products: Transactions only (see CLAUDE.md).

// History requested when an account is first linked. Detection looks back 12 months and
// Plaid recommends at least 180 days for recurring streams.
export const TRANSACTION_DAYS_REQUESTED = 365;

// Transactions per /transactions/sync page (Plaid allows 1 to 500).
export const SYNC_PAGE_SIZE = 500;

// Times a sync restarts from its first page when Plaid's data changes mid-pagination.
export const SYNC_MAX_RESTARTS = 3;

// The daily job syncs items that haven't synced for this long.
export const STALE_SYNC_HOURS = 24;

// Items synced per daily job run, so one run stays well inside the function time limit.
export const CRON_SYNC_LIMIT = 25;

// Webhooks signed longer ago than this are rejected as possible replays (Plaid's advice).
export const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;
