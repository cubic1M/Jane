import type { PrismaClient } from "@/generated/prisma/client";
import { cushionSpendCents } from "@/detectors/helpers";
import { db as defaultClient } from "@/lib/db";
import { loadProfileInput } from "@/lib/profile";

// A month of spending for one person, the one figure their emergency cushion, idle cash, the goal
// Jane drafts, the refund plan and the cash page read (cushionSpendCents, src/detectors/helpers.ts),
// from the same rows the dock's cards read (loadProfileInput). Gate B, 11-16: the drafted goal read
// the typical calendar month to today, idle cash its days to where an old statement ends, and one
// dock said $1,273.14 and $1,423.98 a month for one person.
export async function loadCushionSpendCents(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<number> {
  const input = await loadProfileInput(userId, { client, now });
  return cushionSpendCents(input);
}
