import { RETENTION_PERIODS } from "./retention";

// Requests allowed per window, per user (signed in) or per IP (signed out). Generous for
// people, tight enough to stop scripts. src/lib/rate-limit.ts enforces them.

export type Limit = { limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  // Sign-in and sign-up emails, per IP and per address.
  auth: { limit: 10, windowSeconds: 10 * 60 },
  // Plaid link tokens and token exchanges, per user.
  plaid: { limit: 20, windowSeconds: 10 * 60 },
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
  // Ask Jane questions, per user.
  ask: { limit: 30, windowSeconds: 60 * 60 },
  // Two-factor codes (authenticator or backup), per user.
  mfa: { limit: 5, windowSeconds: 10 * 60 },
  // Uploading documents (each may be read by Claude), per user.
  documents: { limit: 20, windowSeconds: 60 * 60 },
} satisfies Record<string, Limit>;

export type LimitName = keyof typeof RATE_LIMITS;

// Old counter rows are deleted once they're this old (the retention list's period, so the
// privacy policy and both cleanups agree).
export const RATE_LIMIT_RETENTION_HOURS = RETENTION_PERIODS.rateLimits.days * 24;
