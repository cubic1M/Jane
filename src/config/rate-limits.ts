import { RETENTION_PERIODS } from "./retention";

// Requests allowed per window, per user (signed in) or per IP (signed out). Generous for
// people, tight enough to stop scripts. src/lib/rate-limit.ts enforces them.

export type Limit = { limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  // Sign-in and sign-up emails, per IP and per address.
  auth: { limit: 10, windowSeconds: 10 * 60 },
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
  // Unsubscribe links, per IP.
  unsubscribe: { limit: 20, windowSeconds: 10 * 60 },
  // "Download my data", per user.
  export: { limit: 5, windowSeconds: 60 * 60 },
  // Turning phone notifications on or off, per user.
  push: { limit: 20, windowSeconds: 10 * 60 },
  // Calendar apps fetching the money calendar feed, per IP.
  calendar: { limit: 120, windowSeconds: 60 * 60 },
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
  // Questions Claude answers for one sample (Try Jane) person, in all: one very long window.
  claudeTrial: { limit: 25, windowSeconds: 60 * 60 * 24 * 365 * 10 },
} satisfies Record<string, Limit>;

export type LimitName = keyof typeof RATE_LIMITS;

// Old counter rows are deleted once they're this old (the retention list's period, so the
// privacy policy and both cleanups agree).
export const RATE_LIMIT_RETENTION_HOURS = RETENTION_PERIODS.rateLimits.days * 24;

// Counters that outlive the day the cleanup keeps ("claudeTrial:" is a sample person's whole
// allowance, "chatmonth:" is the month's Claude spend): never deleted as old windows.
export const KEEP_RATE_LIMIT_PREFIXES = ["claudeTrial:", "chatmonth:"] as const;
