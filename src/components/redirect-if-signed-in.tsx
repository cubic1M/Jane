import { redirect } from "next/navigation";
import { getSessionState, HOME_PATH } from "@/lib/session";
import { isTrialUser } from "@/lib/trial-ids";

// Render inside <Suspense>: it reads the session cookie. Someone who still owes a
// two-factor code goes to enter it rather than signing in again. Someone trying Jane with a
// sample person (spec step 138) stays: the banner's "Sign up" brings them here to start their
// own account, and signing in replaces the sample person's session.
export async function RedirectIfSignedIn() {
  const state = await getSessionState();
  if (!state || isTrialUser(state.user?.id)) return null;
  redirect(state.mfaPending ? "/mfa" : HOME_PATH);
}
