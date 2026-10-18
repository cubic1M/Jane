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
  // Ask Jane questions, per user.
  ask: { limit: 30, windowSeconds: 60 * 60 },
  // Admin two-factor codes, per user.
  mfa: { limit: 5, windowSeconds: 10 * 60 },
} satisfies Record<string, Limit>;

export type LimitName = keyof typeof RATE_LIMITS;

// Old counter rows are deleted once they're this old.
export const RATE_LIMIT_RETENTION_HOURS = 24;
