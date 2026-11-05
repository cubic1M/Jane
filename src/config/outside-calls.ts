// How long a call to a vendor may take. One that hangs would hold a person's page, or use up a
// nightly job's 300 seconds so the people after it get nothing.
export const OUTSIDE_CALL_TIMEOUT_MS = 15_000;

// Claude's answers take longer, and its SDK's own limit is 10 minutes with 2 retries. One retry
// here keeps a call inside the 300 seconds a function has.
export const CLAUDE_CALL_TIMEOUT_MS = 120_000;
export const CLAUDE_CALL_RETRIES = 1;

// PostHog is awaited in the request, and the database row is the source of truth, so an outage
// there may only cost a moment. Left at its defaults, about 50 seconds an event.
export const POSTHOG_TIMEOUT_MS = 2_000;
export const POSTHOG_RETRIES = 0;

// The most of an events feed or page that's read. They're read with regular expressions.
export const EVENTS_MAX_BODY_CHARS = 2_000_000;
