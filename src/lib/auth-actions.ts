"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
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

export async function signInWithEmail(formData: FormData): Promise<void> {
  const email = formData.get("email");
  if (typeof email !== "string" || !email.includes("@")) redirect("/login?error=InvalidEmail");
  await signInOrShowError("resend", { email: email.trim() });
}

export async function signInWithGoogle(): Promise<void> {
  await signInOrShowError("google", {});
}

export async function signOutToHome(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
