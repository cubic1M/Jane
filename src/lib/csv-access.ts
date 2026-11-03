import type { SessionUser } from "@/lib/session";
import { isSampleTrialUser, isStatementTrialUser } from "@/lib/trial-ids";

// Uploading statements (/import) is the main way in for the closed beta: every signed-in
// person with a real account may, and someone trying Jane with their own statement. Sample trial
// people (spec step 138) are sample data, so they never upload anything of their own.
export function canImportCsv(user: Pick<SessionUser, "id">): boolean {
  return !isSampleTrialUser(user.id);
}

// A brokerage's holdings file (/import/investments): not part of a temporary try, which reads
// bank statements only, with limits of its own (src/config/statement-trial.ts).
export function canImportHoldings(user: Pick<SessionUser, "id">): boolean {
  return canImportCsv(user) && !isStatementTrialUser(user.id);
}
