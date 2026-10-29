import { cookies } from "next/headers";
import { cache } from "react";
import { CHAT_SIGN_IN_GRACE_SECONDS } from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { sessionTokenFrom } from "@/lib/admin-gate";
import { db as defaultClient } from "@/lib/db";

// Each sign-in starts the chat fresh (founder, 2026-10-29): the chat shows, and Claude's answers
// look back over, only what came after this sign-in. Older conversations stay in the database and
// keep teaching Jane about the person (src/lib/memory/); they just aren't shown.

// From when a session's chat is shown: a little before it began, so what was posted as the
// person signed in (Try Jane's first scan, a clock a moment off) still shows.
export function chatSince(signedInAt: Date): Date {
  return new Date(signedInAt.getTime() - CHAT_SIGN_IN_GRACE_SECONDS * 1000);
}

// When this browser's session began (Auth.js keeps one row per sign-in), or null without one.
export async function sessionStartedAt(
  token: string | undefined,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<Date | null> {
  if (!token) return null;
  const session = await client.session.findUnique({
    where: { sessionToken: token },
    select: { createdAt: true },
  });
  return session?.createdAt ?? null;
}

// The start of this sign-in's chat, for the request's own session; undefined (the whole chat)
// when there's no session cookie, as for a test's caller. Once per request.
export const currentChatStart = cache(async (): Promise<Date | undefined> => {
  const started = await sessionStartedAt(sessionTokenFrom(await cookies()));
  return started ? chatSince(started) : undefined;
});
