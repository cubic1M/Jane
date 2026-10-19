import { INSIGHT_MONTHS } from "@/config/insights";
import { loadDetectionInput } from "@/detection/engine";
import { recurringCharges } from "@/detection/subscriptions";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights } from "@/insights/spending";
import { scopedFor } from "@/lib/db-scoped";
import { dollarFigures } from "@/lib/guardrails";
import { CHAT_TOOLS, runChatTool } from "../claude-tools";
import { loadSnapshot } from "../snapshot";

// The person's numbers, as the checks know them (spec step 87): what a right answer's
// figures come from. Loaded once per run with the same loaders as the pages and the chat.

export type Facts = {
  asOf: string;
  safeCents: number | null;
  payday: string | null;
  // Every dollar figure any of the chat's own lookups gives: what an answer may use.
  allowedCents: number[];
  // What charges on a schedule: the last charge and a year's cost.
  recurring: { merchant: string; lastCents: number; yearCents: number; subscription: boolean }[];
  // Spending by month (YYYY-MM): the total and each category's.
  months: Record<string, { totalCents: number; categories: Record<string, number> }>;
  findings: { id: string; type: string; title: string }[];
};

// The chat's lookups that need no input, run once for their figures.
const LOOKUPS = CHAT_TOOLS.filter((t) => {
  const schema = t.input_schema as { required?: string[] };
  return t.name !== "propose_action" && !(schema.required?.length ?? 0);
}).map((t) => t.name);

export async function loadFacts(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Facts> {
  const asOf = now.toISOString().slice(0, 10);
  const [snapshot, input, transactions, lookups] = await Promise.all([
    loadSnapshot(userId, { client, now }),
    loadDetectionInput(userId, { client, now }),
    loadInsightTransactions(scopedFor(userId, client), asOf, INSIGHT_MONTHS),
    Promise.all(LOOKUPS.map((name) => runChatTool(userId, name, {}, { client, now }))),
  ]);
  const insights = spendingInsights(transactions, { asOf, monthCount: INSIGHT_MONTHS });
  const months: Facts["months"] = {};
  for (const m of insights.months) {
    months[m.month] = {
      totalCents: m.spendingCents,
      categories: Object.fromEntries(
        (insights.categoriesByMonth[m.month] ?? []).map((c) => [c.category, c.cents]),
      ),
    };
  }
  return {
    asOf,
    safeCents: snapshot?.safeToSpend?.safeCents ?? null,
    payday: snapshot?.safeToSpend?.payday ?? null,
    allowedCents: lookups.flatMap((out) => [
      ...out.cents,
      ...dollarFigures(out.content).map((f) => f.cents),
    ]),
    recurring: recurringCharges(input).map((r) => ({
      merchant: r.merchant,
      lastCents: r.lastAmountCents,
      yearCents: r.annualCostCents,
      subscription: r.subscription,
    })),
    months,
    findings: (snapshot?.findings ?? []).map((f) => ({
      id: f.findingId,
      type: f.type,
      title: f.title,
    })),
  };
}

// Helpers the question bank's expectations use.
export const lastMonth = (facts: Facts) => {
  const [y, m] = facts.asOf.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
export const thisMonth = (facts: Facts) => facts.asOf.slice(0, 7);

export function charge(facts: Facts, merchant: string) {
  return facts.recurring.find((r) => r.merchant.toLowerCase() === merchant.toLowerCase()) ?? null;
}

export function spentOn(facts: Facts, category: string, month: string): number | null {
  return facts.months[month]?.categories[category] ?? null;
}
