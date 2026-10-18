import type { Session } from "next-auth";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { TERMS_VERSION } from "@/config/legal";
import { adminSessionState, sessionTokenFrom } from "@/lib/admin-gate";

export type SessionUser = Session["user"];

// Where signed-in users go after sign-in.
export const HOME_PATH = "/connect";

export async function getCurrentUser(): Promise<SessionUser | null> {
  // Auth.js makes a random CSRF token on every session lookup. Waiting for the
  // request first keeps Next.js from treating that as part of a prerender.
  await connection();
  const session = await auth();
  return session?.user ?? null;
}

// Signed in and on the current Terms version; otherwise sign in, or accept them once.
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.termsVersion !== TERMS_VERSION) redirect("/terms/accept");
  return user;
}

// Admin pages answer 404 to everyone else, so their existence isn't revealed. Admins
// must also have entered a two-factor code in this session.
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();
  if (user.termsVersion !== TERMS_VERSION) redirect("/terms/accept");
  const state = await adminSessionState(sessionTokenFrom(await cookies()));
  if (state === "needs_mfa") redirect("/mfa");
  if (state !== "verified") notFound();
  return user;
}
