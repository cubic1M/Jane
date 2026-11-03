import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";

// The stop-all switch: nothing goes through the permission check while it's on. Undoing still
// works, so a person can always take something back.

type Options = { client?: PrismaClient; now?: Date };

export async function actsStopped(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { actsStoppedAt: true },
  });
  return Boolean(user?.actsStoppedAt);
}

export async function setActsStopped(
  userId: string,
  stopped: boolean,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  await client.user.update({
    where: { id: userId },
    data: { actsStoppedAt: stopped ? now : null },
  });
  await logAudit(
    { type: "user", id: userId },
    stopped ? "jane_acts_stopped" : "jane_acts_resumed",
    { type: "user", id: userId },
  );
}
