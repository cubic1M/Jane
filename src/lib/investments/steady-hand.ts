import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { detectDrop, type Drop } from "@/planning/steady-hand";
import { loadGoalBuckets } from "./goal-buckets";
import { loadReturns, type Returns } from "./returns";
import type { Bucket } from "@/planning/goal-buckets";

// A steady hand (spec step 163), for Jane's message, her reply, the pause and the tool.

type Options = { client?: PrismaClient; now?: Date; returns?: Returns };

export type SteadyView = { advice: boolean; drop: Drop | null; buckets: Bucket[] };

export async function loadSteadyHand(
  userId: string,
  { client, now = new Date(), returns }: Options = {},
): Promise<SteadyView> {
  const [advice, loaded, goals] = await Promise.all([
    adviceMode(userId, { client }),
    returns ?? loadReturns(userId, { client, now }),
    loadGoalBuckets(userId, { client, now }),
  ]);
  return { advice, drop: detectDrop(loaded.periods), buckets: goals.buckets ?? [] };
}
