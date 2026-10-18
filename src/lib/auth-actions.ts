"use server";

import { AuthError } from "next-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { INVITE_COOKIE } from "@/lib/auth-gate";
import { checkCode, normalizeCode, redeemInvite, type CodeCheck } from "@/lib/invites";
import { hit, ipKey } from "@/lib/rate-limit";
import { HOME_PATH } from "@/lib/session";

// signIn() finishes by throwing a redirect, so only Auth.js errors are caught here.
async function signInOrShowError(provider: string, options: Record<string, string>) {
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
};

const inviteFrom = (formData: FormData) => {
  const value = formData.get("invite");
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export async function signInWithEmail(formData: FormData): Promise<void> {
  const email = formData.get("email");
  if (typeof email !== "string" || !email.includes("@")) redirect("/login?error=InvalidEmail");
  await limitSignIn(email.trim());
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
  const invite = formData ? inviteFrom(formData) : null;
  if (invite) {
    const result = await checkCode(invite);
    if (result !== "ok") redirect(`/signup?error=${INVITE_ERRORS[result]}`);
    (await cookies()).set(INVITE_COOKIE, normalizeCode(invite) as string, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 15 * 60,
      path: "/",
    });
  }
  await signInOrShowError("google", {});
}

export async function signOutToHome(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
