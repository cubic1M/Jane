import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { loadTradeoffs } from "@/lib/goal-tradeoffs";
import type { GoalView } from "@/lib/goals";

// How many months each goal runs late once the person's other goals are counted (src/lib/
// goal-tradeoffs.ts), by goal id: what "on track" reads on every surface (src/planning/goals.ts
// goalOnTrack). Only with two goals or more competing for the same money (spec step 241); none
// late otherwise.
export async function goalsLate(
  userId: string,
  goals: readonly Pick<GoalView, "id">[],
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<Map<string, number | null>> {
  if (goals.length < 2) return new Map();
  const tradeoffs = await loadTradeoffs(userId, { client, now });
  if (!tradeoffs?.competing) return new Map();
  return new Map((tradeoffs.current?.dates ?? []).map((d) => [d.id, d.lateMonths]));
}
