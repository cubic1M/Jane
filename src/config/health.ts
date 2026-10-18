// Health checks (src/lib/health.ts).

// The daily jobs, by the name they record runs under.
export const DAILY_JOBS: readonly string[] = ["plaid-sync", "digest"];
// A daily job counts as missed once its last good run is this old (a day plus slack for
// Vercel's scheduling).
export const JOB_STALE_HOURS = 26;
// How far back /admin/health counts errors.
export const HEALTH_ERROR_HOURS = 24;
