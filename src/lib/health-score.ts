import { HEALTH_MONTHS, HEALTH_SLIP_CATEGORIES, HEALTH_SLIP_DAYS } from "@/config/health-score";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import type { DetectionInput } from "@/detection/types";
import { addDays } from "@/detection/units";
import { spendingInsights } from "@/insights/spending";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listGoals } from "@/lib/goals";
import { incomeOverride, listPreferences } from "@/lib/jane-agent/preferences";
import {
  healthChange,
  healthScore,
  type HealthChange,
  type HealthInput,
  type HealthPartScore,
  type HealthScore,
} from "@/planning/health-score";

// Money health score (spec step 146): worked out from the same bank data as everything
// else, and kept for the month (updated while it runs) so the next month can say how it
// moved. Null for someone with nothing linked yet.

type Options = {
  client?: PrismaClient;
  now?: Date;
  input?: DetectionInput;
  // Keep this month's score (Jane's run does; pages and the chat only read).
  keep?: boolean;
};

export type HealthView = HealthScore & {
  month: string;
  // Last month's score and what moved it, once there is one.
  before: { month: string; score: number; band: string } | null;
  change: HealthChange | null;
};

const monthOf = (day: string) => day.slice(0, 7);
const previousMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

// The inputs, from the bank data and goals.
export async function healthInput(
  userId: string,
  input: DetectionInput,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<HealthInput> {
  const cash = input.accounts.filter(
    (a) =>
      a.type === "depository" &&
      (a.subtype === "checking" || a.subtype === "savings") &&
      a.currentBalanceCents !== null,
  );
  const cards = input.accounts.filter((a) => a.type === "credit");
  // Full months only: the ones before this one.
  const lastFull = addDays(`${monthOf(input.asOf)}-01`, -1);
  const months = spendingInsights(
    input.transactions.map((t) => ({ ...t, pending: false })),
    { asOf: lastFull, monthCount: HEALTH_MONTHS },
  ).months.filter((m) => m.spendingCents > 0 || m.incomeCents > 0);
  const average = (cents: (m: (typeof months)[number]) => number) =>
    months.length === 0
      ? null
      : Math.round(months.reduce((s, m) => s + cents(m), 0) / months.length);
  const since = addDays(input.asOf, -HEALTH_SLIP_DAYS);
  const [goals, prefs] = await Promise.all([
    listGoals(userId, { client, now }),
    listPreferences(userId, { client }),
  ]);
  // Spec step 239: income the person corrected beats the average of the deposits.
  const incomeSaid = incomeOverride(prefs);
  return {
    cashCents: cash.length === 0 ? null : cash.reduce((s, a) => s + a.currentBalanceCents!, 0),
    monthlySpendingCents: average((m) => m.spendingCents),
    monthlyIncomeCents: incomeSaid ?? average((m) => m.incomeCents),
    slips:
      input.transactions.length === 0
        ? null
        : input.transactions.filter(
            (t) =>
              t.date > since &&
              t.amountCents > 0 &&
              t.pfcDetailed !== null &&
              HEALTH_SLIP_CATEGORIES.includes(t.pfcDetailed),
          ).length,
    cardBalanceCents:
      cards.length === 0
        ? null
        : cards.reduce((s, a) => s + Math.max(0, a.currentBalanceCents ?? 0), 0),
    goals: {
      total: goals.length,
      onTrack: goals.filter((g) => g.progress.status !== "date_passed").length,
    },
  };
}

const partsOf = (value: Prisma.JsonValue): HealthPartScore[] =>
  Array.isArray(value) ? (value as unknown as HealthPartScore[]) : [];

// This month's score, kept, with last month's to compare.
export async function healthFor(
  userId: string,
  { client = defaultClient, now = new Date(), input: given, keep = false }: Options = {},
): Promise<HealthView | null> {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  if (input.accounts.length === 0) return null;
  const score = healthScore(await healthInput(userId, input, { client, now }));
  if (!score) return null;
  const month = monthOf(input.asOf);
  const db = scopedFor(userId, client);
  const data = {
    score: score.score,
    band: score.band,
    parts: score.parts as unknown as Prisma.InputJsonArray,
  };
  if (keep) {
    const kept = await db.healthScores.updateMany({ where: { month }, data });
    if (kept.count === 0) {
      await db.healthScores
        .create({ data: { userId, month, ...data } })
        .catch(() => db.healthScores.updateMany({ where: { month }, data }));
    }
  }
  const before = await db.healthScores.findFirst({
    where: { month: previousMonth(month) },
    select: { month: true, score: true, band: true, parts: true },
  });
  return {
    ...score,
    month,
    before: before && { month: before.month, score: before.score, band: before.band },
    change: before
      ? healthChange(score, { score: before.score, parts: partsOf(before.parts) })
      : null,
  };
}

// A month's kept score, for the monthly report (spec step 148).
export async function healthOfMonth(
  userId: string,
  month: string,
  { client = defaultClient }: Options = {},
): Promise<{ score: number; band: string; parts: HealthPartScore[] } | null> {
  const row = await scopedFor(userId, client).healthScores.findFirst({
    where: { month },
    select: { score: true, band: true, parts: true },
  });
  return row && { score: row.score, band: row.band, parts: partsOf(row.parts) };
}
