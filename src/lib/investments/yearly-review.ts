import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listGoals } from "@/lib/goals";
import {
  harvestCandidates,
  harvestKey,
  placeHarvest,
  describeHarvest,
  type HarvestCandidate,
} from "./harvest";

// The yearly investing review's extra facts (spec step 216): the tax-loss harvesting
// candidates, what the goals still need, and whether a raise or a new job just happened.
// The rest of the review is built from what the investing snapshot already holds
// (src/lib/jane-agent/investments/snapshot.ts).

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 86_400_000;

export type ReviewExtras = {
  harvest: HarvestCandidate[];
  harvestKey: string | null;
  goals: {
    name: string;
    percent: number;
    monthlyCents: number | null;
    monthsLeft: number | null;
  }[];
  raise: boolean;
};

// A raise or new job: the last two paychecks average at least this much more than the
// four before them.
export const RAISE_SHARE = 0.08;

export async function loadReviewExtras(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ReviewExtras> {
  const db = scopedFor(userId, client);
  const [harvest, goals, pay] = await Promise.all([
    harvestCandidates(userId, { client, now }),
    listGoals(userId, { client, now }),
    db.transactions.findMany({
      where: {
        pfcDetailed: "INCOME_SALARY",
        amountCents: { lt: 0 },
        date: { gt: new Date(now.getTime() - 150 * DAY_MS), lte: now },
      },
      select: { amountCents: true },
      orderBy: { date: "desc" },
      take: 6,
    }),
  ]);
  const amounts = pay.map((p) => -p.amountCents);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const raise =
    amounts.length >= 6 && avg(amounts.slice(0, 2)) >= avg(amounts.slice(2, 6)) * (1 + RAISE_SHARE);
  return {
    harvest,
    harvestKey: harvest.length > 0 ? harvestKey(harvest) : null,
    goals: goals.map((g) => ({
      name: g.name,
      percent: g.progress.percent,
      monthlyCents: g.progress.status === "on_the_way" ? g.progress.monthlyCents : null,
      monthsLeft: g.progress.status === "on_the_way" ? g.progress.monthsLeft : null,
    })),
    raise,
  };
}

// Tap: harvest the losses the review showed. Only the same list the person saw.
export class ReviewError extends Error {}

export async function harvestFromReview(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  if (!(await adviceMode(userId, { client })))
    throw new ReviewError("This is only in demo advice mode for now.");
  const candidates = await harvestCandidates(userId, { client, now });
  if (candidates.length === 0 || harvestKey(candidates) !== key)
    throw new ReviewError("Your investments changed since the review. Here's the new one.");
  for (const c of candidates) await placeHarvest(userId, c, { client, now });
  return candidates.map(describeHarvest);
}
