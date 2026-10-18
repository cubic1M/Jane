import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";

// Auth.js's database-session cookie: the __Secure- name on HTTPS, the plain one locally.
export const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];

export type AdminSessionState = "verified" | "needs_mfa" | "none";

export function sessionTokenFrom(cookies: { get(name: string): { value: string } | undefined }) {
  return SESSION_COOKIES.map((name) => cookies.get(name)?.value).find(Boolean);
}

// Whether this exact session belongs to an admin, and whether they've entered a
// two-factor code in it. Used by the proxy (before /admin renders) and requireAdmin().
export async function adminSessionState(
  token: string | undefined,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<AdminSessionState> {
  if (!token) return "none";
  const session = await client.session.findUnique({
    where: { sessionToken: token },
    select: { expires: true, mfaVerifiedAt: true, user: { select: { role: true } } },
  });
  if (!session || session.expires <= now || session.user.role !== "admin") return "none";
  return session.mfaVerifiedAt ? "verified" : "needs_mfa";
}
