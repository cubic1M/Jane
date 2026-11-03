import { cookies } from "next/headers";
import { recordFailedSignIn } from "@/lib/auth-events";
import { isAdminEmail, mayCreateAccount, redeemInvite } from "@/lib/invites";

// Auth.js's signIn callback: who may sign in or sign up. Existing users always may;
// new accounts need a redeemed invite code (see src/lib/invites.ts).

// Holds a checked code across the Google redirect, where we don't know the email yet.
export const INVITE_COOKIE = "fc_invite";

// Where asking for a sign-in link always ends. An address that can't sign in goes to the same
// place with nothing sent, so the form can't be used to test who has an account.
export const CHECK_EMAIL_PATH = "/api/auth/verify-request?provider=resend&type=email";

export async function allowSignIn({
  user,
  email: asked,
}: {
  user: { email?: string | null };
  email?: { verificationRequest?: boolean };
}) {
  const email = user.email?.trim().toLowerCase();
  if (!email) return false;
  if (await mayCreateAccount(email)) return true;

  const code = (await cookies()).get(INVITE_COOKIE)?.value;
  if (code && (await redeemInvite(code, email)) === "ok") return true;
  await recordFailedSignIn("no_invite");
  if (asked?.verificationRequest) return CHECK_EMAIL_PATH;
  return "/signup?error=InviteRequired";
}

export { isAdminEmail };
