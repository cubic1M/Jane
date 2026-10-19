import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { coverageGaps, type Gap } from "./gaps";
import { loadHousehold, type Household } from "./household";
import { listPolicies, type Policy } from "./policies";
import { readingsFromDocuments } from "./readings";

// The person's insurance profile (spec step 102): every policy, the household facts and
// the gaps, from the same code as /insurance. Jane's chat, its Claude tools and the page
// all read it from here.

type Options = { client?: PrismaClient; now?: Date };

export type InsuranceProfile = {
  policies: Policy[];
  household: Household;
  gaps: Gap[];
  // Demo advice mode (spec step 98): whether Jane may say what to add or change.
  advice: boolean;
};

export async function loadInsurance(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<InsuranceProfile> {
  // Policy documents not read yet are read for the person to confirm (spec step 151).
  await readingsFromDocuments(userId, { client, now });
  const [policies, household, advice] = await Promise.all([
    listPolicies(userId, { client }),
    loadHousehold(userId, { client, now }),
    adviceMode(userId, { client }),
  ]);
  // Found policies don't count until the person confirms them (spec step 99).
  return { policies, household, gaps: coverageGaps(household, policies), advice };
}

// The demo bank's sample policy (spec step 75): the GEICO car insurance its payments show,
// with the details a policy document would have, renewing soon so the reshop shows. Added
// once, the first time the demo bank syncs; never for real accounts.
export const DEMO_POLICY = {
  kind: "auto",
  carrier: "GEICO",
  premiumCents: 14_200,
  premiumFrequency: "monthly",
  deductibleCents: 100_000,
  coverage: {
    bodilyInjuryPerPerson: 5_000_000,
    bodilyInjuryPerAccident: 10_000_000,
    propertyDamage: 5_000_000,
    collision: true,
    comprehensive: true,
    uninsuredMotorist: true,
  },
  covers: "One car, two drivers: liability, collision and comprehensive.",
  termMonths: 12,
  merchantKey: "geico",
} as const;
// Days from the first sync to the demo policy's renewal.
export const DEMO_RENEWAL_DAYS = 40;

export async function ensureDemoPolicies(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  if ((await db.insurancePolicies.count({ where: { source: "demo" } })) > 0) return false;
  const renewal = new Date(now.getTime() + DEMO_RENEWAL_DAYS * 86_400_000);
  await db.insurancePolicies.create({
    data: {
      userId,
      ...DEMO_POLICY,
      coverage: { ...DEMO_POLICY.coverage },
      source: "demo",
      status: "active",
      renewalDate: new Date(`${renewal.toISOString().slice(0, 10)}T00:00:00Z`),
    },
  });
  return true;
}
