import type { PrismaClient } from "@/generated/prisma/client";
import { reviewPortfolio, type PortfolioReview } from "@/insights/portfolio-review";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { profileSummary, type ProfileSummary } from "@/planning/investor-profile";
import { loadInvestments, type Investments } from "./holdings";
import { profileOf } from "./profile";

// The portfolio review (spec step 131), loaded for its page, Jane's answers and its tools.
// Null until the investor profile is complete: nothing is recommended from half an answer.
// Advice: the callers show it only in demo advice mode.

const PAY_LOOKBACK_MS = 90 * 86_400_000;

export async function loadReview(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    investments: loaded,
  }: { client?: PrismaClient; now?: Date; investments?: Investments } = {},
): Promise<{ investments: Investments; profile: ProfileSummary; review: PortfolioReview | null }> {
  const [investments, answers, pay] = await Promise.all([
    loaded ?? loadInvestments(userId, { client, now }),
    profileOf(userId, { client }),
    // Who pays the person, to spot their employer's shares.
    scopedFor(userId, client).transactions.findMany({
      where: {
        pfcPrimary: "INCOME",
        amountCents: { lt: 0 },
        date: { gte: new Date(now.getTime() - PAY_LOOKBACK_MS) },
      },
      select: { description: true, merchantName: true },
      distinct: ["description"],
      take: 20,
    }),
  ]);
  const profile = profileSummary(answers, now.toISOString().slice(0, 10));
  const payNames = pay.flatMap((p) => [p.description, ...(p.merchantName ? [p.merchantName] : [])]);
  return {
    investments,
    profile,
    review: profile.complete
      ? reviewPortfolio(investments.accounts, profile.riskLevel, payNames)
      : null,
  };
}
