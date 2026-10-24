// Net worth (src/insights/net-worth.ts, src/lib/snapshots.ts).

// Daily balance snapshots are kept this long: two years.
export const SNAPSHOT_RETENTION_DAYS = 730;
// Months shown on /net-worth.
export const NET_WORTH_MONTHS = 12;
// A sample person's past balances (src/lib/plaid/demo-history.ts): working back through an
// account's transactions must not take a bank account below this (a deep overdraft) or a card
// or loan below owing nothing. If it would, the transactions don't explain the balance (a
// payment seen on one side only), and the account is kept at today's balance instead.
export const DEMO_HISTORY_LOWEST_BANK_CENTS = -100_000;
// How far back a sample person's balances go: a year of days, one balance each.
export const DEMO_HISTORY_DAYS = 365;
// Plaid account types that are money owed rather than money held.
export const DEBT_ACCOUNT_TYPES: readonly string[] = ["credit", "loan"];

// Things you own (spec step 67, src/lib/owned-assets.ts).
export const ASSET_KINDS = {
  home: "Home",
  vehicle: "Car or other vehicle",
  other: "Something else of value",
} as const;
// A value older than this is marked for updating.
export const ASSET_VALUE_STALE_DAYS = 365;
// The most a single thing can be entered at, as a typo guard: $20 million (the value is
// stored as a 32-bit integer of cents, which tops out near $21.4 million).
export const MAX_ASSET_CENTS = 2_000_000_000;
export const MAX_ASSET_NAME_LENGTH = 80;
// The loan subtype (Plaid) that usually goes with each kind, for "Add your home's value to
// see your equity" on /loans and /net-worth.
export const ASSET_LOAN_SUBTYPES = { home: "mortgage", vehicle: "auto" } as const;
// The home hub's net worth chart (docs/design/home-hub.md, "Net worth chart"): its ranges, in
// days back from today. ALL runs from the person's first day with Jane and is the default.
export const NET_WORTH_RANGES = [
  { key: "1W", days: 7 },
  { key: "1M", days: 30 },
  { key: "3M", days: 91 },
  { key: "1Y", days: 365 },
] as const;
// The net worth chart's events (src/insights/net-worth-events.ts): the dots on the expanded
// line where money moved because of something. A day's events show when together they move at
// least this much, or this share of net worth, whichever is less; and at most EVENTS_MAX of
// them in the range on screen, the biggest, so the line isn't cluttered.
export const NET_WORTH_EVENT_MIN_CENTS = 50_000;
export const NET_WORTH_EVENT_MIN_SHARE = 0.02;
export const NET_WORTH_EVENTS_MAX = 12;
// An investment account's month counts as an event when it moved at least this much.
export const NET_WORTH_INVESTMENT_MOVE_CENTS = 50_000;
