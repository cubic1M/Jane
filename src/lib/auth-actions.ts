"use server";

import { AuthError } from "next-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signIn, signOut } from "@/auth";
import { TERMS_VERSION } from "@/config/legal";
import { INVITE_COOKIE } from "@/lib/auth-gate";
import { track } from "@/lib/analytics";
import {
  checkCode,
  joinWaitlist,
  normalizeCode,
  redeemInvite,
  type CodeCheck,
} from "@/lib/invites";
import { hit, ipKey } from "@/lib/rate-limit";
import { TERMS_COOKIE } from "@/lib/terms";
import { HOME_PATH } from "@/lib/session";
import { isTrialUser } from "@/lib/trial-ids";

// Signing up or in from a Try Jane session (spec step 138) starts the person's own account.
// The sample person's session ends first: with it still there, Auth.js would link a Google
// sign-in to the sample person, who is deleted after TRIAL_HOURS.
async function leaveTrial(): Promise<void> {
  const session = await auth();
  if (isTrialUser(session?.user?.id)) await signOut({ redirect: false });
}

// signIn() finishes by throwing a redirect, so only Auth.js errors are caught here.
async function signInOrShowError(provider: string, options: Record<string, string>) {
  await leaveTrial();
  try {
    await signIn(provider, { ...options, redirectTo: HOME_PATH });
  } catch (error) {
    if (error instanceof AuthError) redirect(`/login?error=${encodeURIComponent(error.type)}`);
    throw error;
  }
}

// Per IP and, for email links, per address too, so no one can flood an inbox.
async function limitSignIn(email?: string): Promise<void> {
  const subjects = [ipKey(await headers()), ...(email ? [`email:${email.toLowerCase()}`] : [])];
  for (const subject of subjects) {
    if (!(await hit("auth", subject)).ok) redirect("/login?error=TooManyRequests");
  }
}

const INVITE_ERRORS: Record<Exclude<CodeCheck, "ok">, string> = {
  invalid: "InvalidInvite",
  used_up: "InviteUsedUp",
  expired: "InviteExpired",
  revoked: "InviteRevoked",
  wrong_email: "InviteWrongEmail",
};

const SHORT_COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 15 * 60,
  path: "/",
};

// Sign-up (a form with an invite field) needs the Terms box ticked; the consent is
// recorded once the account exists (see auth-events.ts).
async function requireConsent(formData: FormData): Promise<void> {
  if (!formData.has("invite") && !formData.has("consent")) return;
  if (formData.get("consent") !== "on") redirect("/signup?error=ConsentRequired");
  (await cookies()).set(TERMS_COOKIE, TERMS_VERSION, SHORT_COOKIE);
}

const inviteFrom = (formData: FormData) => {
  const value = formData.get("invite");
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export async function signInWithEmail(formData: FormData): Promise<void> {
  const email = formData.get("email");
  if (typeof email !== "string" || !email.includes("@")) redirect("/login?error=InvalidEmail");
  await limitSignIn(email.trim());
  await requireConsent(formData);
  // From /signup: redeem the invite for this email before sending the link.
  const invite = inviteFrom(formData);
  if (invite) {
    const result = await redeemInvite(invite, email);
    if (result !== "ok") redirect(`/signup?error=${INVITE_ERRORS[result]}`);
  }
  await signInOrShowError("resend", { email: email.trim() });
}

export async function signInWithGoogle(formData?: FormData): Promise<void> {
  await limitSignIn();
  // From /signup: Google tells us the email only afterwards, so keep the checked code in a
  // short-lived cookie for the signIn callback to redeem.
  if (formData) await requireConsent(formData);
  const invite = formData ? inviteFrom(formData) : null;
  if (invite) {
    const result = await checkCode(invite);
    if (result !== "ok") redirect(`/signup?error=${INVITE_ERRORS[result]}`);
    (await cookies()).set(INVITE_COOKIE, normalizeCode(invite) as string, SHORT_COOKIE);
  }
  await signInOrShowError("google", {});
}

// The closed beta's waitlist, from /signup without an invite: the email is stored and
// nothing is sent.
export async function joinTheWaitlist(formData: FormData): Promise<void> {
  const email = formData.get("email");
  if (typeof email !== "string" || !email.includes("@") || email.length > 254) {
    redirect("/signup?error=InvalidEmail");
  }
  await limitSignIn();
  if (await joinWaitlist(email)) await track(null, "waitlist_joined", {});
  redirect("/signup?waitlist=joined");
}

export async function signOutToHome(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
