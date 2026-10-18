// Background jobs (src/lib/jobs.ts).

// A job is tried this many times before it's marked failed.
export const JOB_MAX_ATTEMPTS = 5;
// Minutes to wait before each retry (after the 1st, 2nd, ... failure). The daily jobs and
// the next job someone starts pick up whatever is due.
export const JOB_BACKOFF_MINUTES: readonly number[] = [1, 5, 30, 120, 720];
// A job still "running" after this long is assumed lost (the server stopped) and retried.
export const JOB_STUCK_MINUTES = 15;
// Most jobs run in one go.
export const JOB_BATCH = 20;
// Longest error message kept.
export const JOB_ERROR_LENGTH = 500;
