import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";

// Auth.js's database-session cookie: the __Secure- name on HTTPS, the plain one locally.
export const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];

// True when the session token belongs to a live session of an admin. Used by the proxy
// to answer non-admins with a real 404 before any /admin page renders.
export async function isAdminSession(
  token: string | undefined,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<boolean> {
  if (!token) return false;
  const session = await client.session.findUnique({
    where: { sessionToken: token },
    select: { expires: true, user: { select: { role: true } } },
  });
  return Boolean(session && session.expires > now && session.user.role === "admin");
}
