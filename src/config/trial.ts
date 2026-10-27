// Try Jane without signing up (spec step 138): a temporary sample person with the demo
// bank and demo advice.

import { RETENTION_PERIODS } from "@/config/retention";

// How long a trial lasts: its session ends then, and the person and everything they did is
// deleted at the next clean-up (each new trial and the daily retention run).
export const TRIAL_HOURS = RETENTION_PERIODS.trialPeople.days * 24;

// Trial people's ids and addresses, so they're never emailed, contacted or counted. The
// .invalid domain can never receive mail.
export const TRIAL_ID_PREFIX = "trial_";
export const TRIAL_EMAIL_DOMAIN = "try.jane.invalid";

// Trial sessions' tokens start with this, so the proxy can give them their own rate limits
// (src/lib/edge-limits.ts) without a database read. The rest is 256 random bits.
export const TRIAL_SESSION_PREFIX = "trial_";
