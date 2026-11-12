import type { ConfidenceLevel } from "./general";

// Jane's 24/7 engine (src/lib/live/): a finding found the moment something changes (a bank's
// webhook, an offer that moved) is told to the person at once only when it clears this bar, and
// at most LIVE_NOTICES_PER_DAY times a day. Everything else waits for the day's brief.

// A year's saving below this isn't worth interrupting someone for.
export const LIVE_NOTICE_MIN_ANNUAL_CENTS = 10_000;
// Nor is a finding detection is unsure of.
export const LIVE_NOTICE_MIN_CONFIDENCE: ConfidenceLevel = "medium";
// Told at once in any 24 hours, per person.
export const LIVE_NOTICES_PER_DAY = 1;
// A Plaid webhook received this recently is what set a sync off, for the latency it records.
export const LIVE_WEBHOOK_WINDOW_MINUTES = 30;
// Reverse matching (src/lib/live/watches.ts): people scanned again for an offer that moved, per
// run of the offers job; the next hourly run takes the rest.
export const LIVE_MATCHES_PER_RUN = 25;
