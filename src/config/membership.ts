// Membership willingness-to-pay test (spec step 10). No recurring billing.

// After "not now", the offer stays hidden this long; it's also counted as shown at most
// once per period.
export const OFFER_SNOOZE_DAYS = 14;

// One-time founding-member price when MEMBERSHIP_TEST_PRICE isn't set ($49).
export const DEFAULT_PRICE_CENTS = 4900;

// Stripe webhooks signed longer ago than this are rejected (Stripe's default tolerance).
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;
