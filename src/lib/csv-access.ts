import type { SessionUser } from "@/lib/session";
import { isTrialUser } from "@/lib/trial-ids";

// Uploading statements (/import) is the main way in for the closed beta: every signed-in
// person with a real account may. Trial people (spec step 138) are sample data, so they
// never upload anything of their own.
export function canImportCsv(user: Pick<SessionUser, "id">): boolean {
  return !isTrialUser(user.id);
}
