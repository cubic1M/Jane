import { RETENTION_PERIODS } from "./retention";
import { STATEMENT_TRIAL_CHAT_ANSWERS } from "./statement-trial";

// Requests allowed per window, per user (signed in) or per IP (signed out). Generous for
// people, tight enough to stop scripts. src/lib/rate-limit.ts enforces them.

export type Limit = { limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  // Backstops in the proxy (src/lib/edge-limits.ts), before any API route or server action
  // runs, on top of the per-feature limits below. Per IP, and per signed-in session.
  // Polling while a bank scans is about 100 requests a minute, well under these.
  api: { limit: 300, windowSeconds: 60 },
  apiSession: { limit: 300, windowSeconds: 60 },
  // Server actions (forms and buttons that change something).
  actions: { limit: 120, windowSeconds: 60 },
  actionsSession: { limit: 60, windowSeconds: 60 },
  // Try Jane's sample people (spec step 138) get their own, tighter session backstops: anyone
  // can make one without an account.
  trialApi: { limit: 180, windowSeconds: 60 },
  trialActions: { limit: 30, windowSeconds: 60 },
  // Coming back from a sign-in link or from Google, per IP.
  authCallback: { limit: 30, windowSeconds: 10 * 60 },
  // Sign-in and sign-up emails, per IP and per address.
  auth: { limit: 10, windowSeconds: 10 * 60 },
  // Sign-in links actually sent to one address, however they were asked for and from however many
  // IPs. Past these nothing more goes out.
  signInEmail: { limit: 5, windowSeconds: 10 * 60 },
  signInEmailDay: { limit: 20, windowSeconds: 24 * 60 * 60 },
  signInEmailPastDay: { limit: 1, windowSeconds: 60 * 60 },
  // Plaid link tokens and token exchanges, per user.
  plaid: { limit: 20, windowSeconds: 10 * 60 },
  // Gifts through a share link (spec step 213), per IP.
  gift: { limit: 10, windowSeconds: 10 * 60 },
  // Yes, no and undo on decision cards, per user.
  decisions: { limit: 60, windowSeconds: 60 },
  // Membership buttons, per user.
  membership: { limit: 20, windowSeconds: 10 * 60 },
  // Analytics events from the browser, per IP.
  events: { limit: 120, windowSeconds: 60 },
  // Batches from the beta's activity log (one every few seconds per tab), per IP.
  activity: { limit: 120, windowSeconds: 60 },
  // Unsubscribe links, per IP.
  unsubscribe: { limit: 20, windowSeconds: 10 * 60 },
  // "Download my data", per user.
  export: { limit: 5, windowSeconds: 60 * 60 },
  // Turning phone notifications on or off, per user.
  push: { limit: 20, windowSeconds: 10 * 60 },
  // Calendar apps fetching the money calendar feed, per IP.
  calendar: { limit: 120, windowSeconds: 60 * 60 },
  // One authenticator code, once: a code someone saw over a shoulder is still good for a minute or
  // two otherwise.
  mfaCodeUsed: { limit: 1, windowSeconds: 3 * 60 },
  // Two-factor codes (authenticator or backup), per user.
  mfa: { limit: 5, windowSeconds: 10 * 60 },
  // Uploading documents (each may be read by Claude), per user.
  documents: { limit: 20, windowSeconds: 60 * 60 },
  // Tax-time pack CSV downloads, per user (spec step 72).
  taxPack: { limit: 30, windowSeconds: 60 * 60 },
  auditPack: { limit: 30, windowSeconds: 60 * 60 },
  // Messages typed to Jane in the chat, per user (spec step 84).
  chat: { limit: 60, windowSeconds: 60 * 60 },
  // Trying Jane with sample data, per IP (spec step 138): each makes a sample person.
  // 20, not 5: offices, schools and households share one IP, and people try several of the
  // eight sample lives (step 252).
  trial: { limit: 20, windowSeconds: 60 * 60 },
  // The same, for everyone together: rotating IPs can't fill the database with sample people.
  trialEveryone: { limit: 300, windowSeconds: 60 * 60 },
  // Questions Claude answers for one sample (Try Jane) person, in all: one very long window.
  claudeTrial: { limit: 25, windowSeconds: 60 * 60 * 24 * 365 * 10 },
  // Trying Jane with your own statement (src/config/statement-trial.ts): starts per IP, starts by
  // everyone in a UTC day, and answers Claude writes for one temporary person, in all.
  trialStatement: { limit: 10, windowSeconds: 60 * 60 },
  trialStatementDay: { limit: 200, windowSeconds: 60 * 60 * 24 },
  claudeStatementTrial: {
    limit: STATEMENT_TRIAL_CHAT_ANSWERS,
    windowSeconds: 60 * 60 * 24 * 365 * 10,
  },
  // Invite codes made by an admin, per admin.
  invites: { limit: 30, windowSeconds: 60 * 60 },
  // Server errors kept for /admin/errors, and alert emails to the team, across every request. Anyone
  // can cause a server error (a server action posted from another site is one), and a new path means
  // a new alert: a flood can't fill the database or use up the email quota sign-in links need.
  serverErrorsKept: { limit: 300, windowSeconds: 60 * 60 },
  refusedActionsKept: { limit: 20, windowSeconds: 60 * 60 },
  errorAlertEmails: { limit: 10, windowSeconds: 60 * 60 },
  // Reports of something the Content-Security-Policy blocked, per IP (each is stored).
  cspReport: { limit: 20, windowSeconds: 10 * 60 },
  // Reports of a page that broke in a browser, per IP (each is stored, and anyone can send one).
  clientError: { limit: 20, windowSeconds: 10 * 60 },
  // What anyone can make Jane store without an account, per IP on top of the limits above, and
  // across every IP: a flood can't fill the database or bury real errors in /admin/errors.
  anonymousActivity: { limit: 60, windowSeconds: 60 },
  anonymousEvents: { limit: 60, windowSeconds: 60 },
  anonymousEveryone: { limit: 5000, windowSeconds: 60 * 60 },
  errorReportsEveryone: { limit: 300, windowSeconds: 60 * 60 },
} satisfies Record<string, Limit>;

export type LimitName = keyof typeof RATE_LIMITS;

// Old counter rows are deleted once they're this old (the retention list's period, so the
// privacy policy and both cleanups agree).
export const RATE_LIMIT_RETENTION_HOURS = RETENTION_PERIODS.rateLimits.days * 24;

// Counters that outlive the day the cleanup keeps ("claudeTrial:" is a sample person's whole
// allowance, "chatmonth:" is the month's Claude spend): never deleted as old windows. A temporary
// person's own goes with them (src/lib/trial-delete.ts).
export const KEEP_RATE_LIMIT_PREFIXES = [
  "claudeTrial:",
  "claudeStatementTrial:",
  "chatmonth:",
] as const;
