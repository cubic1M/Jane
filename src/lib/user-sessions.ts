import { SESSION_SEEN_EVERY_MINUTES, USER_AGENT_MAX_LENGTH } from "@/config/sessions";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { describeDevice, lastActiveLabel } from "@/lib/devices";

// Devices and sessions (spec step 73): where someone is signed in, and signing out
// elsewhere. Sessions are named by their row id; the session token works as a password,
// so it is only ever compared on the server and never selected for the page.

type Options = { client?: PrismaClient; now?: Date };

export type DeviceSession = {
  id: string;
  device: string;
  signedIn: string;
  lastActive: string;
  current: boolean;
};

// Notes the device and time for the session behind this cookie. Writes only when the
// session hasn't been seen for SESSION_SEEN_EVERY_MINUTES, so page views don't write
// every time. Never stores an IP address.
export async function noteSessionSeen(
  token: string,
  userAgent: string | null,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const cutoff = new Date(now.getTime() - SESSION_SEEN_EVERY_MINUTES * 60_000);
  const trimmed = userAgent?.trim().slice(0, USER_AGENT_MAX_LENGTH) || null;
  await client.session.updateMany({
    where: { sessionToken: token, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }] },
    data: { lastSeenAt: now, ...(trimmed ? { userAgent: trimmed } : {}) },
  });
}

// The row id of the session behind this cookie, if it belongs to this person.
async function currentSessionId(
  client: PrismaClient,
  userId: string,
  token: string | undefined,
): Promise<string | null> {
  if (!token) return null;
  const row = await client.session.findFirst({
    where: { sessionToken: token, userId },
    select: { id: true },
  });
  return row?.id ?? null;
}

// The person's unexpired sessions, this one first, then the most recently used.
export async function listSessions(
  userId: string,
  token: string | undefined,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<DeviceSession[]> {
  const [currentId, rows] = await Promise.all([
    currentSessionId(client, userId, token),
    client.session.findMany({
      where: { userId, expires: { gt: now } },
      // Never the session token.
      select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true },
    }),
  ]);
  // This session is in use right now, whatever its last noted time says.
  const lastUsed = (row: (typeof rows)[number]) =>
    row.id === currentId ? now : (row.lastSeenAt ?? row.createdAt);
  return rows
    .sort((a, b) => lastUsed(b).getTime() - lastUsed(a).getTime())
    .map((row) => ({
      id: row.id,
      device: describeDevice(row.userAgent),
      signedIn: row.createdAt.toISOString().slice(0, 10),
      lastActive: lastActiveLabel(lastUsed(row), now),
      current: row.id === currentId,
    }));
}

export type SignOutResult = "ok" | "not_found";

// Signs one of the person's other sessions out. Another person's session, an unknown id
// or the current session (that's the ordinary "Sign out") change nothing.
export async function signOutSession(
  userId: string,
  sessionId: string,
  token: string | undefined,
  { client = defaultClient }: Options = {},
): Promise<SignOutResult> {
  if (!token || !sessionId) return "not_found";
  const { count } = await client.session.deleteMany({
    where: { id: sessionId, userId, sessionToken: { not: token } },
  });
  if (count === 0) return "not_found";
  await logAudit({ type: "user", id: userId }, "session_signed_out", {
    type: "session",
    id: sessionId,
  });
  await track(userId, "session_signed_out", { count });
  return "ok";
}

// Signs out every unexpired session of the person's except this one, and returns how many
// ended, so the count matches the list. Expired ones already don't work, and the daily
// cleanup (src/lib/retention.ts) deletes them.
export async function signOutOtherSessions(
  userId: string,
  token: string | undefined,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  // Without this session's token we can't tell which one to keep, so do nothing.
  if (!token) return 0;
  const { count } = await client.session.deleteMany({
    where: { userId, sessionToken: { not: token }, expires: { gt: now } },
  });
  await logAudit(
    { type: "user", id: userId },
    "other_sessions_signed_out",
    { type: "user", id: userId },
    { count },
  );
  await track(userId, "other_sessions_signed_out", { count });
  return count;
}
