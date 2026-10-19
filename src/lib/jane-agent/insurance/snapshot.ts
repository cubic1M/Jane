import type { PrismaClient } from "@/generated/prisma/client";
import type { Gap } from "@/lib/insurance/gaps";
import type { Household } from "@/lib/insurance/household";
import { nextRenewal, type Policy } from "@/lib/insurance/policies";
import { loadInsurance } from "@/lib/insurance/profile";

// What Jane's brain knows about the person's insurance (spec Phase X), from the same loader
// as /insurance.

export type InsuranceSnapshot = {
  policies: (Policy & { nextRenewal: string | null })[];
  gaps: Gap[];
  household: Household;
  // Demo advice mode (spec step 98).
  advice: boolean;
};

export async function loadInsuranceSnapshot(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<InsuranceSnapshot> {
  const asOf = now.toISOString().slice(0, 10);
  const { policies, gaps, household, advice } = await loadInsurance(userId, { client, now });
  return {
    policies: policies.map((p) => ({ ...p, nextRenewal: nextRenewal(p, asOf) })),
    gaps,
    household,
    advice,
  };
}
