// Net worth (src/insights/net-worth.ts, src/lib/snapshots.ts).

// Daily balance snapshots are kept this long: two years.
export const SNAPSHOT_RETENTION_DAYS = 730;
// Months shown on /net-worth.
export const NET_WORTH_MONTHS = 12;
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
// The most a single thing can be entered at, as a typo guard: $50 million.
export const MAX_ASSET_CENTS = 5_000_000_000;
