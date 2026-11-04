import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { isStatementTrialUser } from "@/lib/trial-ids";

// What someone tells us during a try (founder 11-04), for the founders (/admin/reports). A try is
// deleted, so this isn't tied to the person and stays. /privacy says so, and the box asks them to
// leave out names and account numbers; what looks like one goes anyway.

const WHY = "Feedback from a try: deliberately tied to no person, so it outlives the try";
const LONG_NUMBER = /\d(?:[ -]?\d){7,}/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/gi;

export const scrubFeedback = (message: string): string =>
  message.replace(EMAIL, "[email]").replace(LONG_NUMBER, "[number]");

export async function saveTryFeedback(
  userId: string,
  feedback: { path: string; message: string },
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<void> {
  await systemDb(WHY, client).tryFeedback.create({
    data: {
      kind: isStatementTrialUser(userId) ? "statement" : "sample",
      path: feedback.path,
      message: scrubFeedback(feedback.message),
    },
    select: { id: true },
  });
}

export async function recentTryFeedback({
  client = defaultClient,
}: { client?: PrismaClient } = {}) {
  return systemDb(WHY, client).tryFeedback.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, kind: true, path: true, message: true, createdAt: true },
  });
}
