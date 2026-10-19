import type { PrismaClient } from "@/generated/prisma/client";
import { loadInvestments } from "@/lib/investments/holdings";

// What Jane's brain knows about the person's investments (spec step 128 on), loaded with
// the same code as the investments page. Each later investment step adds its part here.

export type InvestmentSnapshot = {
  totalCents: number;
  holdingCount: number;
  accounts: { id: string; name: string; label: string; balanceCents: number | null }[];
};

export async function loadInvestmentSnapshot(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<InvestmentSnapshot> {
  const investments = await loadInvestments(userId, { client, now });
  return {
    totalCents: investments.totalCents,
    holdingCount: investments.holdingCount,
    accounts: investments.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      label: a.label,
      balanceCents: a.balanceCents,
    })),
  };
}
