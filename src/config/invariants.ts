// The nightly checks on live data (src/lib/invariants/nightly.ts).

// How far back rows are looked at.
export const INVARIANT_WINDOW_DAYS = 90;
// A card payment's other side may post a few days away...
export const CARD_PAYMENT_MATCH_DAYS = 5;
// ...and one newer than this may just not have been imported yet.
export const CARD_PAYMENT_SETTLE_DAYS = 7;
