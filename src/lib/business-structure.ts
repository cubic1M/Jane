import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { loadSelfEmployed } from "@/lib/self-employed";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import { structureFor, type Structure } from "@/planning/business-structure";

// Business owners' tax structure (spec step 267), loaded from the person's own estimate:
// the qualified business income deduction they get, whether an S corporation would save
// more than its costs at their profit, a salary range, and the home office and miles that
// are or aren't on file. Facts for everyone; the S corporation recommendation is demo advice.

type Options = { client?: PrismaClient; now?: Date };

export type BusinessView = {
  year: number;
  advice: boolean;
  // Self-employment profit this year (after tagged business expenses).
  active: boolean;
  structure: Structure | null;
  homeOffice: { sqft: number | null; deductionCents: number };
  mileage: { miles: number; deductionCents: number };
};

export async function loadBusinessStructure(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView; advice: boolean } } = {},
): Promise<BusinessView> {
  const se = await loadSelfEmployed(userId, { client, now, ...(loaded ? { loaded } : {}) });
  const input = se.estimate.input;
  const profit = input.income.selfEmploymentCents;
  return {
    year: se.year,
    advice: se.advice,
    active: se.active && profit > 0,
    structure: profit > 0 ? structureFor(input) : null,
    homeOffice: se.homeOffice,
    mileage: se.mileage,
  };
}
