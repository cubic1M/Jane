import { CONTROLLER_NEWS_HOURS, type ControllerStep } from "@/config/controller";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The nightly controller run's log (spec step 142), to read: kept apart from
// src/lib/controller.ts, which runs every sector, so the chat and pages read it cheaply.

export type StepResult = { did: string; changed: number };
export type StepLog = StepResult & {
  step: ControllerStep;
  status: "ok" | "failed" | "skipped";
  ms: number;
};

export const logsOf = (value: Prisma.JsonValue): StepLog[] =>
  Array.isArray(value) ? (value as unknown as StepLog[]) : [];

const HOUR_MS = 60 * 60 * 1000;

export type LastRun = { day: string; finishedAt: Date | null; steps: StepLog[] };

// The latest run, if it's recent enough to talk about: "What I checked last night".
export async function lastControllerRun(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<LastRun | null> {
  const run = await scopedFor(userId, client).controllerRuns.findFirst({
    where: { finishedAt: { gte: new Date(now.getTime() - CONTROLLER_NEWS_HOURS * HOUR_MS) } },
    orderBy: { day: "desc" },
    select: { day: true, finishedAt: true, steps: true },
  });
  return run ? { day: run.day, finishedAt: run.finishedAt, steps: logsOf(run.steps) } : null;
}
