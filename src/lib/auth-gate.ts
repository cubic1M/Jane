import { cookies, headers } from "next/headers";
import { sessionTokenFrom } from "@/lib/admin-gate";
import { recordFailedSignIn } from "@/lib/auth-events";
import { mayCreateAccount, normalizeCode, redeemInvite } from "@/lib/invites";
import { hit, ipKey } from "@/lib/rate-limit";
import { emailOfSession } from "@/lib/user-sessions";

// Auth.js's signIn callback: who may sign in or sign up. Existing users always may;
// new accounts need a redeemed invite code (see src/lib/invites.ts).

// Holds a checked code across the Google redirect, where we don't know the email yet.
export const INVITE_COOKIE = "fc_invite";

// Where asking for a sign-in link always ends. An address that can't sign in goes to the same
// place with nothing sent, so the form can't be used to test who has an account.
export const CHECK_EMAIL_PATH = "/api/auth/verify-request?provider=resend&type=email";

const MAX_EMAIL_LENGTH = 254;

// Why this Google sign-in can't go on, if it can't. src/auth.ts lets Google join an account with the
// same address, so that address must be one Google has checked; and Auth.js adds a Google account to
// whoever is signed in, so someone with a moment at a signed-in screen could add their own, which
// would still sign them in long after every session was ended.
async function googleRefusal(
  email: string,
  profile: { email?: string | null; email_verified?: boolean | null } | null | undefined,
): Promise<string | null> {
  if (profile?.email_verified !== true) return "google_unverified";
  if (profile.email?.trim().toLowerCase() !== email) return "google_other_account";
  const signedInAs = await emailOfSession(sessionTokenFrom(await cookies()));
  return signedInAs && signedInAs.toLowerCase() !== email ? "google_other_account" : null;
}

export async function allowSignIn({
  user,
  account,
  profile,
  email: asked,
}: {
  user: { email?: string | null };
  account?: { provider?: string } | null;
  profile?: { email?: string | null; email_verified?: boolean | null } | null;
  email?: { verificationRequest?: boolean };
}) {
  const email = user.email?.trim().toLowerCase();
  if (!email) return false;
  // Auth.js's own route doesn't pass through the form's check, and this address gets saved.
  if (email.length > MAX_EMAIL_LENGTH) {
    return asked?.verificationRequest ? CHECK_EMAIL_PATH : false;
  }
  if (account?.provider === "google") {
    const refusal = await googleRefusal(email, profile);
    if (refusal) {
      await recordFailedSignIn(refusal);
      return "/login?error=GoogleAccountRefused";
    }
  }
  if (await mayCreateAccount(email)) return true;

  const code = (await cookies()).get(INVITE_COOKIE)?.value;
  // Auth.js's own email route reaches here without the form's limit on one code from one place
  // (src/lib/auth-actions.ts), and the cookie is anyone's to set: each try spent a use for an
  // address nobody had proven, so one script emptied a code in a minute. The same limit here.
  if (code && asked?.verificationRequest) {
    const here = `${ipKey(await headers())}:${normalizeCode(code)}`;
    if (!(await hit("inviteRedeem", here)).ok) {
      await recordFailedSignIn("rate_limited");
      return CHECK_EMAIL_PATH;
    }
  }
  if (code && (await redeemInvite(code, email)) === "ok") return true;
  await recordFailedSignIn("no_invite");
  if (asked?.verificationRequest) return CHECK_EMAIL_PATH;
  return "/signup?error=InviteRequired";
}
