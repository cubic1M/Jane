import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import type { FeeSummary } from "@/insights/investment-fees";
import type { PortfolioReview } from "@/insights/portfolio-review";
import { loadFees } from "@/lib/investments/fees";
import { loadInvestments } from "@/lib/investments/holdings";
import type { RebalancePlan } from "@/insights/rebalance";
import { loadRebalance } from "@/lib/investments/rebalance";
import { loadRetirement } from "@/lib/investments/retirement";
import { loadReview } from "@/lib/investments/review";
import type { RetirementPlan } from "@/planning/retirement";
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
  // Spec step 130: what investing costs, and the lower-cost equivalents.
  fees: Pick<FeeSummary, "totalYearlyCents" | "overYears" | "equivalents" | "years">;
  // Spec step 131: the mix against the profile's target; null until the profile is done.
  review: PortfolioReview | null;
  // Spec step 132: on track for retirement; null until the profile is done.
  retirement: RetirementPlan | null;
  // Spec step 133: the orders that move to the recommended mix; null until the profile is
  // done (or outside demo advice mode).
  rebalance: RebalancePlan | null;
};

export async function loadInvestmentSnapshot(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<InvestmentSnapshot> {
  const investments = await loadInvestments(userId, { client, now });
  const [{ fees }, { review }, { retirement }, { plan: rebalance }, advice, profile] =
    await Promise.all([
      loadFees(userId, { client, now, investments }),
      loadReview(userId, { client, now, investments }),
      loadRetirement(userId, { client, now, investments }),
      loadRebalance(userId, { client, now, investments }),
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
    fees: {
      totalYearlyCents: fees.totalYearlyCents,
      overYears: fees.overYears,
      equivalents: fees.equivalents,
      years: fees.years,
    },
    review,
    retirement,
    rebalance,
  };
}
