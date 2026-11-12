// Health checks (src/lib/health.ts).

// The daily jobs, by the name they record runs under.
export const DAILY_JOBS: readonly string[] = [
  "plaid-sync",
  // Deleting temporary tries, by itself at the start of plaid-sync's run (src/lib/trial-delete.ts).
  "trial-cleanup",
  "digest",
  "market-history",
  "paper-run",
  "practice-scan",
  // The events overlay's daily job (src/lib/events/run.ts).
  "events",
  // What must hold on live data, in counts only (src/lib/invariants/nightly.ts).
  "invariants",
  // Every real person's figures against what must hold, in counts only (src/lib/invariants/accuracy.ts).
  "accuracy",
];
// A daily job counts as missed once its last good run is this old (a day plus slack for
// Vercel's scheduling).
export const JOB_STALE_HOURS = 26;
// How far back /admin/health counts errors.
export const HEALTH_ERROR_HOURS = 24;

// Error alerts (src/lib/error-alerts.ts): at most one email per kind of error per this many
// minutes, and the daily digest lists at most this many kinds.
export const ERROR_ALERT_MINUTES = 60;
export const ERROR_DIGEST_KINDS = 10;

// How long a scheduled job waits on a heartbeat ping, or an error on its Sentry report, before
// carrying on without it.
export const HEARTBEAT_TIMEOUT_MS = 3_000;
export const SENTRY_TIMEOUT_MS = 3_000;
// How long the hourly probe waits for one page (src/lib/probe.ts).
export const PROBE_TIMEOUT_MS = 15_000;
// How old the emergency switches may be, and the longest a request waits to read them.
export const OPS_SWITCH_CACHE_MS = 5_000;
export const OPS_SWITCH_READ_TIMEOUT_MS = 800;
// A new instance knows nothing yet, so it waits longer rather than serve through a stop.
export const OPS_SWITCH_FIRST_READ_TIMEOUT_MS = 3_000;
