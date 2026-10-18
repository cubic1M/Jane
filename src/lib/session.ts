import type { Session } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";

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
