import { isDemoItemId } from "@/lib/plaid/demo";
import { isTrialEmail, isTrialUser } from "@/lib/trial-ids";

// Who gets the weekly email. Pure, so each rule is tested directly: real people with real
// accounts who haven't turned it off. Trial people (spec step 138) and people whose only bank is
// the demo bank are sample data, so they never get one, whatever their settings say.

export type DigestCandidate = {
  id: string;
  email: string;
  digestEnabled: boolean;
  deletedAt: Date | null;
  // Every bank login's Plaid item id, and how many accounts came from a CSV upload.
  plaidItemIds: readonly string[];
  csvAccounts: number;
  accounts: number;
};

export type NoDigestReason = "trial" | "opted_out" | "deleted" | "no_accounts" | "demo_only";

// Every account is from the demo bank: the same test as demo advice mode (src/lib/advice-mode.ts).
export const isDemoOnly = (plaidItemIds: readonly string[], csvAccounts: number): boolean =>
  plaidItemIds.length > 0 && csvAccounts === 0 && plaidItemIds.every(isDemoItemId);

// Why this person gets no weekly email, or null when they get one.
export function whyNoDigest(c: DigestCandidate): NoDigestReason | null {
  if (isTrialUser(c.id) || isTrialEmail(c.email)) return "trial";
  if (c.deletedAt) return "deleted";
  if (!c.digestEnabled) return "opted_out";
  if (c.accounts === 0) return "no_accounts";
  if (isDemoOnly(c.plaidItemIds, c.csvAccounts)) return "demo_only";
  return null;
}
