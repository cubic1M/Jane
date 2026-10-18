import { redirect } from "next/navigation";
import { getSessionState, HOME_PATH } from "@/lib/session";

// Render inside <Suspense>: it reads the session cookie. Someone who still owes a
// two-factor code goes to enter it rather than signing in again.
export async function RedirectIfSignedIn() {
  const state = await getSessionState();
  if (state) redirect(state.mfaPending ? "/mfa" : HOME_PATH);
  return null;
}
