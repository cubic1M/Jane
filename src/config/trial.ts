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

// The one-tap demo link, /try (for people reviewing Jane): it opens on a sample person whose
// first scan already ran, so the findings are there at once. This many are kept ready, made
// ahead with the plain demo bank; each is a trial person like any other (deleted TRIAL_HOURS
// after it was made, or after it was handed out).
export const TRIAL_POOL_SIZE = 3;

// Topping up counts only the ready people made in the last this many hours, so the daily
// top-up (/api/cron/try-pool) makes new ones before yesterday's reach TRIAL_HOURS and go.
// Older ones are still handed out first, until then.
export const TRIAL_POOL_FRESH_HOURS = 12;

// A ready person's address has this before the @ until someone is given it: how the link finds
// one nobody has yet (still at TRIAL_EMAIL_DOMAIN, so never emailed).
export const TRIAL_POOL_EMAIL_TAG = "+ready";

// With none ready (a burst of visitors), the link makes one there and then and waits at most
// this long for its accounts and transactions to be in before opening the report, which then
// fills in as the scan goes.
export const TRY_LINK_READY_WAIT_MS = 8000;
