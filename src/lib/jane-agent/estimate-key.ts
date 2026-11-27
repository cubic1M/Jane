import { TAX_ESTIMATE_STEP_CENTS } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";

// The tax estimate card is posted again whenever the figure it shows moves by
// TAX_ESTIMATE_STEP_CENTS from the one last posted. The card's key carries the amount it was
// posted at (`estimate:<year>:at<cents>`, said by the taxes source), so the last posted amount is
// read back from the newest message of the year: no second store, and no bucket edge (a bucket of
// 500 dollars reposts for a 2-dollar move across its edge, and not for a 499-dollar move inside it).
const prefix = (year: number) => `taxes:estimate:${year}:at`;

// The key ends `at<cents>n<seq>`: seq counts the year's cards, so coming back to an amount a card
// was posted at before is a new key (a key is never posted twice).
export type EstimatePosted = { cents: number; seq: number };

export async function lastEstimatePosted(
  userId: string,
  year: number,
  client: PrismaClient,
): Promise<EstimatePosted | null> {
  const last = await scopedFor(userId, client).janeMessages.findFirst({
    where: { dedupeKey: { startsWith: prefix(year) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { dedupeKey: true },
  });
  const m = last ? /^(-?\d+)n(\d+)$/.exec(last.dedupeKey.slice(prefix(year).length)) : null;
  return m ? { cents: Number(m[1]), seq: Number(m[2]) } : null;
}

// The card's key suffix: the last posted card's own (the same key, so nothing is posted) while the
// balance is within a step of it, else the balance with the next number (a new key, so it is).
export function estimateKeySuffix(balanceCents: number, posted: EstimatePosted | null): string {
  if (posted && Math.abs(balanceCents - posted.cents) < TAX_ESTIMATE_STEP_CENTS) {
    return `at${posted.cents}n${posted.seq}`;
  }
  return `at${balanceCents}n${(posted?.seq ?? 0) + 1}`;
}
