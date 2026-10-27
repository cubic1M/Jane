import { CHAT_BLOCK_ROWS } from "@/config/agent-chat";
import { INSIGHT_MONTHS } from "@/config/insights";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ComingUpRow } from "@/insights/coming-up";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights, type InsightTransaction } from "@/insights/spending";
import { CARD_SELECT } from "@/lib/cards";
import { comparisonFor } from "@/lib/compare";
import { scopedFor } from "@/lib/db-scoped";
import { listGoals, type GoalView } from "@/lib/goals";
import { homeSummary } from "@/lib/home";
import { formatCents } from "@/lib/money";
import { optionLabel, type Comparison } from "@/planning/compare";
import type { AnswerBlock } from "./blocks";
import { monthLabel } from "@/lib/day-label";

// Spec step 94: blocks from the same numbers as the pages (Insights, Today, Goals and a
// finding's options), so their figures match. Builders are pure; buildBlock loads.

// Spending by category in one month, the most first (as on Insights).
export function spendingBlock(
  transactions: InsightTransaction[],
  asOf: string,
  month: string,
): AnswerBlock | null {
  const insights = spendingInsights(transactions, { asOf, monthCount: INSIGHT_MONTHS });
  const rows = (insights.categoriesByMonth[month] ?? [])
    .filter((c) => c.cents > 0)
    .slice(0, CHAT_BLOCK_ROWS)
    .map((c) => ({ label: c.category, cents: c.cents }));
  return rows.length === 0
    ? null
    : {
        type: "bars",
        title: `Spending in ${monthLabel(month, { long: true, year: false })}`,
        rows,
      };
}

// Spending each month, oldest first (as on Insights).
export function monthsBlock(transactions: InsightTransaction[], asOf: string): AnswerBlock | null {
  const insights = spendingInsights(transactions, { asOf, monthCount: INSIGHT_MONTHS });
  const rows = insights.months
    .slice(-CHAT_BLOCK_ROWS)
    .map((m) => ({ label: monthLabel(m.month, { year: false }), cents: m.spendingCents }));
  return rows.some((r) => r.cents > 0) ? { type: "bars", title: "Spending by month", rows } : null;
}

// What's coming up, soonest first (as on Today).
export function comingUpBlock(rows: readonly ComingUpRow[], title: string): AnswerBlock | null {
  return rows.length === 0
    ? null
    : {
        type: "timeline",
        title,
        rows: rows.map((r) => ({ date: r.date, label: r.label, cents: r.amountCents })),
      };
}

// Each goal's progress (as on Goals).
export function goalsBlock(goals: readonly GoalView[]): AnswerBlock | null {
  return goals.length === 0
    ? null
    : {
        type: "progress",
        title: "Your goals",
        rows: goals.map((g) => ({
          label: g.name,
          doneCents: g.progress.savedCents,
          totalCents: g.targetCents,
        })),
      };
}

// The options compared for a finding: Jane's pick first (as on its card).
export function optionsBlock(comparison: Comparison): AnswerBlock {
  const savings = comparison.current.kind === "savings";
  return {
    type: "table",
    title: savings ? "What each would earn" : "What each would cost",
    columns: ["Option", "1st year", savings ? "More" : "Saves"],
    rows: [comparison.pick, ...comparison.runnersUp].map((s) => [
      optionLabel(s.option),
      formatCents(s.firstYearCents),
      formatCents(s.savingCents),
    ]),
  };
}

export const BLOCK_KINDS = [
  "spending_by_category",
  "spending_by_month",
  "coming_up",
  "goals",
  "options",
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export async function buildBlock(
  userId: string,
  kind: BlockKind,
  {
    client,
    now,
    month,
    findingId,
  }: { client: PrismaClient; now: Date; month?: string; findingId?: string },
): Promise<AnswerBlock | null> {
  const asOf = now.toISOString().slice(0, 10);
  const db = () => scopedFor(userId, client);
  switch (kind) {
    case "spending_by_category":
    case "spending_by_month": {
      const transactions = await loadInsightTransactions(db(), asOf, INSIGHT_MONTHS);
      return kind === "spending_by_month"
        ? monthsBlock(transactions, asOf)
        : spendingBlock(
            transactions,
            asOf,
            month && /^\d{4}-\d{2}$/.test(month) ? month : asOf.slice(0, 7),
          );
    }
    case "coming_up":
      return comingUpBlock(
        (await homeSummary(userId, { client, now }))?.comingUp ?? [],
        "Coming up",
      );
    case "goals":
      return goalsBlock(await listGoals(userId, { client, now }));
    case "options": {
      if (!findingId) return null;
      const finding = await db().findings.findFirst({
        where: { id: findingId },
        select: { ...CARD_SELECT, status: true },
      });
      const comparison = finding && (await comparisonFor(finding, { userId, client, now }));
      return comparison ? optionsBlock(comparison) : null;
    }
  }
}
