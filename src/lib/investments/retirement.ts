import { EMPLOYER_CONTRIBUTION } from "@/config/retirement";
import type { PrismaClient } from "@/generated/prisma/client";
import { isRetirement } from "@/insights/investments";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { currentAge, profileSummary, type ProfileSummary } from "@/planning/investor-profile";
import { retirementPlan, type RetirementPlan } from "@/planning/retirement";
import { employerPlanFor } from "./employer-plan";
import { loadInvestments, type Investments } from "./holdings";
import { profileOf } from "./profile";

// The retirement planner (spec step 132), loaded for its page, Jane's answers and its
// tools: retirement balances, the last 12 months of contributions, the employer plan
// (a stand-in) and the age from the investor profile. Null until the profile is complete.

const YEAR_MS = 365 * 86_400_000;

export async function loadRetirement(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    investments: loaded,
    guessedAge = null,
  }: {
    client?: PrismaClient;
    now?: Date;
    investments?: Investments;
    // An age standing for the person's stage of life, used when they haven't finished the
    // investor profile (the chat's planner, which says it is a guess).
    guessedAge?: number | null;
  } = {},
): Promise<{
  profile: ProfileSummary;
  balanceCents: number;
  accounts: string[];
  retirement: RetirementPlan | null;
  // True when the plan was worked out with guessedAge, not the person's own answers.
  ageGuessed?: boolean;
}> {
  const investments = loaded ?? (await loadInvestments(userId, { client, now }));
  const retirementAccounts = investments.accounts.filter((a) => isRetirement(a.subtype));
  const [answers, plan, contributions] = await Promise.all([
    profileOf(userId, { client }),
    employerPlanFor(userId, client),
    retirementAccounts.length === 0
      ? Promise.resolve([])
      : scopedFor(userId, client).investmentTransactions.findMany({
          where: {
            accountId: { in: retirementAccounts.map((a) => a.id) },
            subtype: "contribution",
            date: { gt: new Date(now.getTime() - YEAR_MS), lte: now },
          },
          select: { name: true, amountCents: true },
        }),
  ]);
  const asOf = now.toISOString().slice(0, 10);
  const profile = profileSummary(answers, asOf);
  const balanceCents = retirementAccounts.reduce((s, a) => s + (a.balanceCents ?? 0), 0);
  // Contributions are money in: negative in Plaid's sign.
  const sum = (employer: boolean) =>
    contributions
      .filter((c) => EMPLOYER_CONTRIBUTION.test(c.name) === employer)
      .reduce((s, c) => s - c.amountCents, 0);
  const told = profile.complete ? currentAge(answers, asOf) : null;
  const age = told ?? guessedAge;
  return {
    profile,
    balanceCents,
    accounts: retirementAccounts.map((a) => a.name),
    ageGuessed: told === null && guessedAge !== null,
    retirement:
      age !== null && retirementAccounts.length > 0
        ? retirementPlan({
            age,
            balanceCents,
            employeeCents: Math.max(0, sum(false)),
            employerCents: Math.max(0, sum(true)),
            plan,
          })
        : null,
  };
}
