// The beta's activity log (src/lib/activity/): what the browser sends, how often, and what the
// server keeps. How long it's kept is in src/config/retention.ts (activityEvents).

// What the browser may record. Anything else is dropped by POST /api/activity.
export const ACTIVITY_KINDS = [
  "page_view",
  "page_time",
  "click",
  "rage_click",
  "submit",
  "focus",
  "blur",
  "error",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY = {
  // The browser sends what it has every few seconds, and when the page is hidden.
  flushEveryMs: 5_000,
  // At most this many events in one request (the browser sends the rest next time).
  maxBatch: 50,
  // Biggest request body the route reads.
  maxBodyBytes: 64 * 1024,
  // Rage click: this many clicks on about the same spot within this long.
  rageClicks: 3,
  rageWindowMs: 1_000,
  rageRadiusPx: 30,
  // Errors recorded per page load, so one broken loop can't flood the log.
  maxErrorsPerPage: 5,
  // Longest label, form or field name kept, and longest error message.
  maxLabel: 80,
  maxError: 200,
  // Most field names kept for one form submit.
  maxFields: 30,
  // An event's own time is kept if it's within this long before (or a minute after) the
  // server's clock; otherwise the server's time is used.
  maxClockSkewMs: 60 * 60 * 1000,
  // Visits in the founder view: a gap this long between events starts a new one.
  visitGapMs: 30 * 60 * 1000,
} as const;

// The one page an anonymous visitor's views are recorded on (nothing else before sign-in).
export const ANONYMOUS_PAGES: readonly string[] = ["/"];

// Shown on the sign-up screen and in the privacy policy, word for word.
export const ACTIVITY_DISCLOSURE =
  "During the beta we record how you use Jane (pages and buttons, not what you type) to improve it.";
