import { cookies } from "next/headers";
import { recordFailedSignIn } from "@/lib/auth-events";
import { isAdminEmail, mayCreateAccount, redeemInvite } from "@/lib/invites";

// Auth.js's signIn callback: who may sign in or sign up. Existing users always may;
// new accounts need a redeemed invite code (see src/lib/invites.ts).

// Holds a checked code across the Google redirect, where we don't know the email yet.
export const INVITE_COOKIE = "fc_invite";

export async function allowSignIn({ user }: { user: { email?: string | null } }) {
  const email = user.email?.trim().toLowerCase();
  if (!email) return false;
  if (await mayCreateAccount(email)) return true;

  const code = (await cookies()).get(INVITE_COOKIE)?.value;
  if (code && (await redeemInvite(code, email)) === "ok") return true;
  await recordFailedSignIn("no_invite");
  return "/signup?error=InviteRequired";
}

export { isAdminEmail };
