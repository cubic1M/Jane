import { TAX_ESTIMATE_STEP_CENTS } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";

// The tax estimate card is posted again whenever the figure it shows moves by
// TAX_ESTIMATE_STEP_CENTS from the one last posted. The card's key carries the amount it was
// posted at (`estimate:<year>:at<cents>`, said by the taxes source), so the last posted amount is
// read back from the newest message of the year: no second store, and no bucket edge (a bucket of
// 500 dollars reposts for a 2-dollar move across its edge, and not for a 499-dollar move inside it).
const prefix = (year: number) => `taxes:estimate:${year}:at`;

export async function lastEstimatePostedCents(
  userId: string,
  year: number,
  client: PrismaClient,
): Promise<number | null> {
  const last = await scopedFor(userId, client).janeMessages.findFirst({
    where: { dedupeKey: { startsWith: prefix(year) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { dedupeKey: true },
  });
  const cents = last ? /^-?\d+$/.exec(last.dedupeKey.slice(prefix(year).length)) : null;
  return cents ? Number(cents[0]) : null;
}

// The amount the card's key is built on: the last posted one while the balance is within a step
// of it (the same key, so nothing is posted), else the balance itself (a new key, so it is).
export function estimateAnchorCents(balanceCents: number, postedCents: number | null): number {
  return postedCents !== null && Math.abs(balanceCents - postedCents) < TAX_ESTIMATE_STEP_CENTS
    ? postedCents
    : balanceCents;
}
