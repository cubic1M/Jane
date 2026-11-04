import { hit } from "@/lib/rate-limit";
import { isTrialUser } from "@/lib/trial-ids";

// Whether this click may rework everything Jane found. It's seconds of the server's time, and
// someone trying Jane needs no sign-in, so it's counted for them. Real people have their own limits.
export async function mayRescan(
  userId: string,
  limit: "trialRescans" | "trialRemovals" = "trialRescans",
): Promise<boolean> {
  return !isTrialUser(userId) || (await hit(limit, userId)).ok;
}
