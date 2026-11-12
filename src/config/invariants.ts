// The nightly checks on live data (src/lib/invariants/nightly.ts).

// How far back rows are looked at.
export const INVARIANT_WINDOW_DAYS = 90;
// A card payment's other side may post a few days away...
export const CARD_PAYMENT_MATCH_DAYS = 5;
// ...and one newer than this may just not have been imported yet.
export const CARD_PAYMENT_SETTLE_DAYS = 7;

// The daily accuracy checks on real people's figures (src/lib/invariants/accuracy.ts).
// A pending charge posts or goes within 1-5 business days, "up to fourteen days in rare situations"
// (plaid.com/docs/transactions/transactions-data): one older than this was never taken away.
export const PENDING_STALE_DAYS = 14;
// A transaction dated after the person's today by more than this is in the future. A day of slack:
// a bank's day can be ahead of the person's.
export const FUTURE_SLACK_DAYS = 1;
// The whole run gets this long; whoever isn't reached by then is counted as not checked.
export const ACCURACY_BUDGET_MS = 240_000;
