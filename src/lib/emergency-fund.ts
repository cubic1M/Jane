import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { loadProfile } from "@/lib/profile";
import { emergencyTarget, type EmergencyTarget } from "@/planning/emergency-fund";

// The emergency fund, sized one way everywhere (docs/feature-audit.md, cluster 13): the drafted
// goal (spec step 55), the cash page (spec step 162) and the refund plan (spec step 125) all use
// emergencyTarget with what the profile knows (how the person is paid, debt trouble, income),
// so a freelancer is never told three months on one page and six on another.

export type FundProfile = {
  pattern: string | null;
  debtTrouble: boolean;
  incomeCents: number | null;
};

// What the profile says about how they're paid and whether debt is a struggle. Undefined when
// it can't be worked out: the fund is then months of spending.
export async function fundProfile(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<FundProfile | undefined> {
  return loadProfile(userId, { client, now })
    .then((p) => ({
      pattern:
        typeof p.facts.income_pattern.value === "string" ? p.facts.income_pattern.value : null,
      debtTrouble: p.facts.debt_trouble.value === true,
      incomeCents:
        typeof p.facts.monthly_income.value === "number" ? p.facts.monthly_income.value : null,
    }))
    .catch(() => undefined);
}

export function fundTarget(
  monthlySpendingCents: number,
  profile: FundProfile | undefined,
): EmergencyTarget | null {
  return emergencyTarget({
    spendingCents: monthlySpendingCents,
    incomeCents: profile?.incomeCents ?? null,
    pattern: profile?.pattern ?? null,
    debtTrouble: profile?.debtTrouble ?? false,
  });
}
