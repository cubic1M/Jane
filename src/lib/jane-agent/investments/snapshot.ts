import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { loadInvestments } from "@/lib/investments/holdings";
import { profileOf } from "@/lib/investments/profile";
import type { ProfileAnswers } from "@/planning/investor-profile";

// What Jane's brain knows about the person's investments (spec step 128 on), loaded with
// the same code as the investments pages. Each later investment step adds its part here.

export type InvestmentSnapshot = {
  totalCents: number;
  holdingCount: number;
  accounts: { id: string; name: string; label: string; balanceCents: number | null }[];
  // Spec step 98: demo advice mode, the only time Jane recommends anything here.
  advice: boolean;
  // Spec step 129: what the investments are for, as answered so far.
  profile: ProfileAnswers;
};

export async function loadInvestmentSnapshot(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<InvestmentSnapshot> {
  const [investments, advice, profile] = await Promise.all([
    loadInvestments(userId, { client, now }),
    adviceMode(userId, { client }),
    profileOf(userId, { client }),
  ]);
  return {
    totalCents: investments.totalCents,
    holdingCount: investments.holdingCount,
    accounts: investments.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      label: a.label,
      balanceCents: a.balanceCents,
    })),
    advice,
    profile,
  };
}
