import { EMPLOYEE_DEFERRAL_LIMIT_CENTS } from "@/config/retirement";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import {
  accountOrder,
  assetLocation,
  rothOrTraditionalByRate,
  unrealisedGains,
  type AccountStep,
  type GainsView,
  type LocationMove,
} from "@/planning/account-order";
import type { ProfileSummary } from "@/planning/investor-profile";
import { loadInvestments, type Investments } from "./holdings";
import { loadRetirement } from "./retirement";

// The right account for each dollar (spec step 135), loaded for its page, Jane's answers
// and its tools: the order to fill accounts in (from the profile, the employer match and
// the marginal rate in the tax estimate, step 120), where each holding is best kept, and
// gains and losses not yet realised. The order needs a finished profile; the gains are
// facts for everyone; the order and the moves are advice, shown in demo advice mode only.

export type AccountPlan = {
  advice: boolean;
  profile: ProfileSummary;
  marginalRate: number | null;
  rothOrTraditional: ReturnType<typeof rothOrTraditionalByRate>;
  order: AccountStep[] | null;
  location: LocationMove[];
  gains: GainsView;
};

export async function loadAccountPlan(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    investments: loaded,
  }: { client?: PrismaClient; now?: Date; investments?: Investments } = {},
): Promise<AccountPlan> {
  const investments = loaded ?? (await loadInvestments(userId, { client, now }));
  const [advice, retirement, estimate, hsa] = await Promise.all([
    adviceMode(userId, { client }),
    loadRetirement(userId, { client, now, investments }),
    // The tax estimate needs a filing status; without one there's no marginal rate.
    loadTaxEstimate(userId, { client, now }).catch(() => null),
    scopedFor(userId, client).accounts.count({ where: { subtype: "hsa" } }),
  ]);
  const marginalRate = estimate?.estimate.marginalRate ?? null;
  const profile = retirement.profile;
  const plan = retirement.retirement;
  return {
    advice,
    profile,
    marginalRate,
    rothOrTraditional: rothOrTraditionalByRate(marginalRate),
    order: profile.complete
      ? accountOrder({
          age: profile.age,
          horizon: profile.horizon,
          goals: profile.goals,
          marginalRate,
          match: plan?.match ?? null,
          employeeCents: plan
            ? EMPLOYEE_DEFERRAL_LIMIT_CENTS + plan.catchUpCents - plan.roomCents
            : 0,
          catchUpCents: plan?.catchUpCents ?? 0,
          hasHsa: hsa > 0,
        })
      : null,
    location: assetLocation(investments.accounts, marginalRate),
    gains: unrealisedGains(investments.accounts),
  };
}
