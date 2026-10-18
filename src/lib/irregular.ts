import { loadDetectionInput } from "@/detection/engine";
import type { PrismaClient } from "@/generated/prisma/client";
import { irregularCosts as fromInput, type IrregularCosts } from "@/insights/irregular";
import { db as defaultClient } from "@/lib/db";

// Saving for irregular costs (spec step 70), for one person. Read from the same
// detection input as the bills forecast and safe to spend (the last 12 months, every
// account with its type, Plaid's streams), so the dates and amounts agree across pages.
export async function irregularCosts(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<IrregularCosts> {
  return fromInput(await loadDetectionInput(userId, { client, now }));
}
