import { COLLEGE_TYPES, type CollegeType } from "@/config/college";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadWorkingProfile } from "@/lib/tax-profile";
import {
  collegeGoal,
  comparePlans,
  costRange,
  monthlyRange,
  yearsUntilCollege,
  type PlanComparison,
  type Range,
} from "@/planning/college";
import { isoDay as iso } from "@/lib/dates";

// College savings (spec step 158), for its page, Jane's answers and its buttons. The state
// tax break uses the tax profile's state and filing status. Setting it up saves a college
// goal, which step 157's buckets and automatic investing fund by themselves.

type Options = { client?: PrismaClient; now?: Date };

export class CollegeError extends Error {}

export type CollegeEstimate = {
  childAge: number;
  type: CollegeType;
  years: number;
  cost: Range;
  monthly: Range;
  plans: PlanComparison[];
  state: string | null;
};

export async function estimateCollege(
  userId: string,
  input: { childAge: number; type: CollegeType },
  { client = defaultClient }: Options = {},
): Promise<CollegeEstimate> {
  const { profile } = await loadWorkingProfile(userId, { client });
  const monthly = monthlyRange(input.type, input.childAge);
  const cost = costRange(input.type, input.childAge);
  const yearly = Math.round(((monthly.lowCents + monthly.highCents) / 2) * 12);
  return {
    childAge: input.childAge,
    type: input.type,
    years: yearsUntilCollege(input.childAge),
    cost,
    monthly,
    plans: comparePlans(
      profile.state,
      profile.filingStatus,
      yearly,
      (cost.lowCents + cost.highCents) / 2,
    ),
    state: profile.state,
  };
}

export async function loadCollege(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const db = scopedFor(userId, client);
  const [advice, plans, tax] = await Promise.all([
    adviceMode(userId, { client }),
    db.collegePlans.findMany({
      select: {
        id: true,
        childName: true,
        childAge: true,
        ageOn: true,
        collegeType: true,
        planKey: true,
        goalId: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    loadWorkingProfile(userId, { client }),
  ]);
  const asOf = iso(now);
  const withAges = await Promise.all(
    plans.map(async (p) => {
      const age =
        p.childAge + Math.floor((Date.parse(asOf) - p.ageOn.getTime()) / (365.25 * 86_400_000));
      const type = (p.collegeType === "private" ? "private" : "public") as CollegeType;
      return {
        ...p,
        age,
        type,
        estimate: await estimateCollege(userId, { childAge: age, type }, { client }),
      };
    }),
  );
  return {
    advice,
    plans: withAges,
    children: tax.profile.childrenUnder17,
    state: tax.profile.state,
  };
}

// Set up saving for one child: the plan and its goal. Demo advice mode only.
export async function startCollegePlan(
  userId: string,
  input: { childName: string; childAge: number; type: CollegeType },
  { client = defaultClient, now = new Date() }: Options = {},
) {
  if (!(await adviceMode(userId, { client }))) {
    throw new CollegeError("College savings plans are only in demo advice mode for now.");
  }
  const name = input.childName.trim().slice(0, 40) || "your child";
  if (!Number.isInteger(input.childAge) || input.childAge < 0 || input.childAge > 17) {
    throw new CollegeError("Enter the child's age, from 0 to 17.");
  }
  if (!Object.hasOwn(COLLEGE_TYPES, input.type)) throw new CollegeError("Pick a kind of college.");
  const asOf = iso(now);
  const estimate = await estimateCollege(
    userId,
    { childAge: input.childAge, type: input.type },
    { client },
  );
  const goal = collegeGoal(name, input.type, input.childAge, asOf);
  // The goal itself, like one added on the goals page, tracked by hand until a 529 is linked.
  const created = await scopedFor(userId, client).savingsGoals.create({
    data: {
      userId,
      name: goal.name,
      targetCents: goal.targetCents,
      targetDate: new Date(`${goal.targetDate}T00:00:00Z`),
      manualSavedCents: 0,
    },
    select: { id: true },
  });
  const plan = await scopedFor(userId, client).collegePlans.create({
    data: {
      userId,
      childName: name,
      childAge: input.childAge,
      ageOn: new Date(`${asOf}T00:00:00Z`),
      collegeType: input.type,
      planKey: estimate.plans[0]?.plan.key ?? null,
      goalId: created.id,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "college_plan_saved",
    { type: "college_plan", id: plan.id },
    { type: input.type },
  );
  await track(userId, "college_plan_started", { type: input.type });
  return { planId: plan.id, goal, estimate };
}
