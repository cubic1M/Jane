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

// Someone trying Jane with their own statement (src/lib/statement-trial.ts) is a trial person too,
// so everything keyed on TRIAL_ID_PREFIX (never emailed, in no analytics or metrics, deleted on
// time) holds. But it's real data: anything that treats a trial person as sample data asks
// isSampleTrialUser (src/lib/trial-ids.ts). Sample ids carry hex after the prefix, so never this.
export const STATEMENT_TRIAL_ID_PREFIX = `${TRIAL_ID_PREFIX}own_`;

// Trial sessions' tokens start with this, so the proxy can give them their own rate limits
// (src/lib/edge-limits.ts) without a database read. The rest is 256 random bits.
export const TRIAL_SESSION_PREFIX = "trial_";
