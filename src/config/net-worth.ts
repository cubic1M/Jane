// Net worth (src/insights/net-worth.ts, src/lib/snapshots.ts).

// Daily balance snapshots are kept this long: two years.
export const SNAPSHOT_RETENTION_DAYS = 730;
// Months shown on /net-worth.
export const NET_WORTH_MONTHS = 12;
// Plaid account types that are money owed rather than money held.
export const DEBT_ACCOUNT_TYPES: readonly string[] = ["credit", "loan"];
