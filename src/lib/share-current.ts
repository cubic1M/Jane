import { SHARE_MIN_FOUND_CENTS } from "@/config/share";
import { moneyFound } from "@/detection/engine";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadCheckup } from "@/lib/checkup";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { cardFor, type ShareCard } from "@/lib/share-card";

// The person's card as it is now, from the same numbers the report shows.
export async function currentCard(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<ShareCard | null> {
  const foundCents = await moneyFound(userId, { client });
  if (foundCents >= SHARE_MIN_FOUND_CENTS) return cardFor({ foundCents, checks: 0 });
  const open = await scopedFor(userId, client).findings.findMany({
    where: { status: { in: ["new", "shown"] } },
    select: { type: true },
  });
  const checks = await loadCheckup(
    userId,
    open.map((f) => f.type),
    { client },
  );
  return cardFor({ foundCents, checks: checks.length });
}
