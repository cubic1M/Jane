import { STATEMENT_TRIAL_ID_PREFIX, TRIAL_EMAIL_DOMAIN, TRIAL_ID_PREFIX } from "@/config/trial";

// Who is a trial person (spec step 138), by id or address: never emailed, contacted or
// counted. Kept apart from src/lib/trial.ts so the email, analytics and agent code can use
// it without importing the bank sync.

export const isTrialUser = (userId: string | null | undefined): boolean =>
  typeof userId === "string" && userId.startsWith(TRIAL_ID_PREFIX);

// A temporary person trying Jane with their own statement: real data, real-account rules.
export const isStatementTrialUser = (userId: string | null | undefined): boolean =>
  typeof userId === "string" && userId.startsWith(STATEMENT_TRIAL_ID_PREFIX);

// A trial person whose data is the demo bank: fake data, with the demo's full flow.
export const isSampleTrialUser = (userId: string | null | undefined): boolean =>
  isTrialUser(userId) && !isStatementTrialUser(userId);

export const isTrialEmail = (address: string): boolean =>
  address.toLowerCase().endsWith(`@${TRIAL_EMAIL_DOMAIN}`);
