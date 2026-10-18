import type { Session } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";

export type SessionUser = Session["user"];

// Where signed-in users go after sign-in. Switch to "/connect" when Plaid lands in step 7.
export const HOME_PATH = "/import";

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  return session?.user ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// Admin pages answer 404 to everyone else, so their existence isn't revealed.
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();
  return user;
}
