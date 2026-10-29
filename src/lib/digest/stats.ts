import { TRIAL_ID_PREFIX } from "@/config/trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";

// The weekly email's numbers, for the founders' numbers page: how many were sent since a date,
// to how many people, how many were opened (Resend's open, when tracking is on) and how many
// had a link clicked (a visit back to Jane). Real people only: trial people are never counted.

export type DigestNumbers = { sent: number; people: number; opened: number; clicked: number };

export async function digestNumbers({
  client = defaultClient,
  since,
}: {
  client?: PrismaClient;
  since: Date;
}): Promise<DigestNumbers> {
  const rows = await client.digest.findMany({
    where: { sentAt: { gte: since }, NOT: { userId: { startsWith: TRIAL_ID_PREFIX } } },
    select: { userId: true, emailOpenedAt: true, openedAt: true },
  });
  return {
    sent: rows.length,
    people: new Set(rows.map((r) => r.userId)).size,
    // A click means it was opened, even when the open itself wasn't seen (images off).
    opened: rows.filter((r) => r.emailOpenedAt || r.openedAt).length,
    clicked: rows.filter((r) => r.openedAt).length,
  };
}
