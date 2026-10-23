import {
  DEMO_MATCH_RATE,
  DEMO_MATCH_UP_TO,
  DEMO_PAYCHECK_GROSS,
} from "@/data-sources/demo/demo-holdings";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { demoPersonFor, isDemoItemId } from "@/lib/plaid/demo";
import type { EmployerPlan } from "@/planning/retirement";

// The person's pay and their employer plan's match (spec step 132). Plaid reports neither:
// bank data shows take-home pay, not pay before deductions, and no plan says its match
// rules. A stand-in behind an interface, like the demo bank: the original demo bank's person has
// the demo employer's plan; everyone else has none until a payroll or plan partner (or the
// person's own answer) is connected. The sample people (step 252) have none either: their pay
// isn't the demo paycheck, and their demo data has no 401(k) contributions to measure a pace from,
// so the plan read them all as putting in 0% (found in the investing debugging pass).

export interface EmployerPlanSource {
  planFor(userId: string, client: PrismaClient): Promise<EmployerPlan | null>;
}

const PAYCHECKS_A_YEAR = 24;

export const demoEmployerPlans: EmployerPlanSource = {
  async planFor(userId, client) {
    const items = await scopedFor(userId, client).plaidItems.findMany({
      select: { plaidItemId: true },
    });
    if (!items.some((i) => isDemoItemId(i.plaidItemId))) return null;
    if (await demoPersonFor(userId, { client })) return null;
    return {
      payCents: DEMO_PAYCHECK_GROSS * 100 * PAYCHECKS_A_YEAR,
      matchRate: DEMO_MATCH_RATE,
      matchUpTo: DEMO_MATCH_UP_TO,
    };
  },
};

// The source in use. Swap in a payroll or plan-record-keeper partner here.
export const EMPLOYER_PLANS: EmployerPlanSource = demoEmployerPlans;

export const employerPlanFor = (userId: string, client: PrismaClient = defaultClient) =>
  EMPLOYER_PLANS.planFor(userId, client);
