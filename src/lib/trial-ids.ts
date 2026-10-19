import { TRIAL_EMAIL_DOMAIN, TRIAL_ID_PREFIX } from "@/config/trial";

// Who is a trial person (spec step 138), by id or address: never emailed, contacted or
// counted. Kept apart from src/lib/trial.ts so the email, analytics and agent code can use
// it without importing the bank sync.

export const isTrialUser = (userId: string | null | undefined): boolean =>
  typeof userId === "string" && userId.startsWith(TRIAL_ID_PREFIX);

export const isTrialEmail = (address: string): boolean =>
  address.toLowerCase().endsWith(`@${TRIAL_EMAIL_DOMAIN}`);
