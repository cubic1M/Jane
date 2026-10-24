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
