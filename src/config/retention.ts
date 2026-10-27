// Data retention (spec steps 11 and 43). The privacy policy's retention section is written
// from this file (src/lib/retention.ts), so the two can't disagree.

// Linked banks are removed from Plaid after this many days without the person using the
// app, so we stop paying for (and holding) connections nobody uses.
export const INACTIVE_ITEM_DAYS = 60;

// We email this many days before removing them.
export const REMOVAL_WARNING_DAYS = 7;

// Things only a person does; system work like syncs doesn't count as activity.
export const ACTIVITY_EVENTS: readonly string[] = [
  "signed_in",
  "report_viewed",
  "insights_viewed",
  "alerts_viewed",
  "debt_planner_viewed",
  "loans_viewed",
  "plan_viewed",
  "plan_yes_to_all",
  "card_opened",
  "decision_yes",
  "decision_no",
  "decision_undone",
  "diy_started",
  "diy_done",
  "digest_clicked",
  "link_started",
  "link_succeeded",
  "import_completed",
  "upload_removed",
  "uploaded_account_removed",
  "uploads_reset",
  "membership_reserved",
  "membership_checkout_started",
  "checklist_dismissed",
  "documents_viewed",
  "document_uploaded",
  // Taxes (spec step 118).
  "tax_profile_answered",
  "taxes_viewed",
];

// Records deleted by the daily cleanup once they're this many days old. `policy` is how
// the privacy policy names them.
export const RETENTION_PERIODS = {
  analyticsEvents: {
    days: 395,
    policy: "Records of which pages and buttons were used",
  },
  // The beta's activity log (src/lib/activity/), apart from the funnel events above.
  activityEvents: {
    days: 180,
    policy: "During the beta, records of how you used Jane (pages and buttons, not what you typed)",
  },
  errorEvents: {
    days: 90,
    policy: "Error reports (with personal details removed)",
  },
  finishedJobs: {
    days: 30,
    policy: "Records of background work, like writing card text",
  },
  cronRuns: {
    days: 90,
    policy: "Records of our scheduled jobs (no personal data)",
  },
  rateLimits: {
    days: 1,
    policy: "Request counters we use to stop abuse",
  },
  expiredSessions: {
    days: 0,
    policy: "Sign-in sessions and sign-in links, once they've expired",
  },
  // The access log (src/config/access-log.ts): just over a year, so a yearly security audit
  // can look back over the whole year it covers.
  accessLog: {
    days: 400,
    policy:
      "Security records of sign-ins, sign-outs, two-factor and bank-link changes, data downloads, account deletions and team access, with the time, IP address and browser",
  },
  // Spec step 138.
  trialPeople: {
    days: 1,
    policy:
      "Sample people made when someone tries Jane without signing up, and everything done with them",
  },
} as const satisfies Record<string, { days: number; policy: string }>;

export type RetainedKind = keyof typeof RETENTION_PERIODS;
