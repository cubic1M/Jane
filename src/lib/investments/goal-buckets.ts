import { RETIREMENT_AGE } from "@/config/retirement";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { autopilotOf } from "@/lib/autopilot";
import { db as defaultClient } from "@/lib/db";
import { listGoals } from "@/lib/goals";
import { goalBuckets, type Bucket } from "@/planning/goal-buckets";
import { profileSummary } from "@/planning/investor-profile";
import { profileOf } from "./profile";

// Every goal invested for its timeline (spec step 157), for its page, Jane's answers, her
// tools and automatic investing: the person's savings goals and, when the money is for
// retirement, retirement at 67. Needs a finished profile (its risk level caps the stocks).

// Jane splits new money by bucket by herself at these autopilot levels; below them she
// only shows the buckets.
export const BUCKETS_BY_HERSELF: readonly string[] = ["safe", "all", "custom"];

export async function loadGoalBuckets(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<{ advice: boolean; byHerself: boolean; buckets: Bucket[] | null }> {
  const asOf = now.toISOString().slice(0, 10);
  const [advice, answers, goals, level] = await Promise.all([
    adviceMode(userId, { client }),
    profileOf(userId, { client }),
    listGoals(userId, { client, now }),
    autopilotOf(userId, { client }),
  ]);
  const profile = profileSummary(answers, asOf);
  if (!profile.complete) return { advice, byHerself: false, buckets: null };
  const inputs = goals
    .filter((g) => g.targetDate > asOf)
    .map((g) => ({
      id: g.id,
      name: g.name,
      targetDate: g.targetDate,
      monthlyCents: g.progress.status === "on_the_way" ? g.progress.monthlyCents : 0,
    }));
  if (profile.goals.includes("retirement") && profile.age < RETIREMENT_AGE) {
    const year = Number(asOf.slice(0, 4)) + (RETIREMENT_AGE - profile.age);
    inputs.push({
      id: "retirement",
      name: "Retirement",
      targetDate: `${year}${asOf.slice(4)}`,
      monthlyCents: 0,
    });
  }
  return {
    advice,
    byHerself: BUCKETS_BY_HERSELF.includes(level ?? ""),
    buckets: goalBuckets(inputs, asOf, profile.riskLevel),
  };
}
