import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { normalizeMerchant } from "@/data-sources/merchant";
import { findInDirectory } from "@/data-sources/merchant-directory";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights } from "@/insights/spending";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { BudgetError, setBudget } from "@/lib/budgets";
import { CategoryError, merchantRuleKey, setMerchantCategory } from "@/lib/categories";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { GoalError, addGoal } from "@/lib/goals";
import { proposals, type Proposal } from "@/planning/proposals";

// Set-up Jane proposes on the plan (spec step 55): budgets from the person's own averages,
// an emergency fund from their own spending, categories for merchants that have none.
// Nothing is created until they say yes; a no is kept so it doesn't come back.

type Options = { client?: PrismaClient; now?: Date };

export class ProposalError extends Error {}

// Works out today's proposals from the person's data.
export async function currentProposals(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Proposal[]> {
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const [transactions, budgets, goals, uncategorized, directory] = await Promise.all([
    loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
    db.budgets.findMany({ select: { category: true, amountCents: true } }),
    db.savingsGoals.findMany({ select: { name: true } }),
    db.transactions.findMany({
      where: { pfcPrimary: null, amountCents: { gt: 0 } },
      select: { description: true, merchantName: true },
    }),
    client.merchant.findMany(),
  ]);
  const summary = budgetSummary(transactions, budgets, asOf);
  // Average spending over the complete months before this one.
  const months = spendingInsights(transactions, {
    asOf,
    monthCount: BUDGET_SUGGESTION_MONTHS + 1,
  }).months.slice(0, -1);
  const monthlySpendingCents =
    months.length === 0
      ? 0
      : Math.round(months.reduce((sum, m) => sum + m.spendingCents, 0) / months.length);

  const byMerchant = new Map<string, { name: string; count: number }>();
  for (const t of uncategorized) {
    const key = merchantRuleKey(t.description);
    if (!key) continue;
    const name = t.merchantName ?? normalizeMerchant(t.description)?.name ?? key;
    const entry = byMerchant.get(key) ?? { name, count: 0 };
    entry.count += 1;
    byMerchant.set(key, entry);
  }
  return proposals({
    asOf,
    suggestions: summary.suggestions,
    budgetedCategories: budgets.map((b) => b.category),
    goalNames: goals.map((g) => g.name),
    monthlySpendingCents,
    uncategorized: [...byMerchant].map(([merchantKey, { name, count }]) => {
      // The directory's own name and category ("The New York Times", not "Nytimes").
      const known = findInDirectory(merchantKey, directory);
      return {
        merchantKey,
        merchantName: known?.name ?? name,
        transactions: count,
        directoryCategory: known?.category ?? null,
      };
    }),
  });
}

// Keeps the open proposals in step with the data. Answered ones stay as they are.
export async function refreshProposals(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const fresh = await currentProposals(userId, { client, now });
  const existing = await db.planProposals.findMany({ select: { key: true, status: true } });
  const answered = new Set(existing.filter((p) => p.status !== "open").map((p) => p.key));
  const freshKeys = new Set(fresh.map((p) => p.key));
  // Open proposals that no longer apply (a budget set by hand, say) go away.
  await db.planProposals.deleteMany({
    where: { status: "open", key: { notIn: [...freshKeys] } },
  });
  for (const proposal of fresh) {
    if (answered.has(proposal.key)) continue;
    const payload = proposal as unknown as Prisma.InputJsonObject;
    await db.planProposals.upsert({
      where: { userId_key: { userId, key: proposal.key } },
      create: { userId, key: proposal.key, kind: proposal.kind, payload },
      update: { payload },
    });
  }
}

export async function openProposals(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<Proposal[]> {
  const rows = await scopedFor(userId, client).planProposals.findMany({
    where: { status: "open" },
    select: { payload: true },
    orderBy: [{ kind: "asc" }, { key: "asc" }],
  });
  return rows.map((r) => r.payload as unknown as Proposal);
}

export type ProposalChanges = { amount?: string; date?: string; detailed?: string };

// Yes (with any changes) creates the budget, goal or category rule; no just remembers it.
export async function answerProposal(
  userId: string,
  key: string,
  accept: boolean,
  changes: ProposalChanges = {},
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const row = await db.planProposals.findFirst({
    where: { key, status: "open" },
    select: { id: true, payload: true },
  });
  if (!row) throw new ProposalError("That suggestion isn't open anymore.");
  const proposal = row.payload as unknown as Proposal;
  if (accept) {
    try {
      if (proposal.kind === "budget") {
        await setBudget(
          userId,
          proposal.category,
          changes.amount?.trim() || String(proposal.amountCents / 100),
          { client },
        );
      } else if (proposal.kind === "goal") {
        await addGoal(
          userId,
          {
            name: proposal.name,
            target: changes.amount?.trim() || String(proposal.targetCents / 100),
            targetDate: changes.date?.trim() || proposal.targetDate,
            accountId: "",
            saved: "",
          },
          { client },
        );
      } else {
        await setMerchantCategory(
          userId,
          proposal.merchantKey,
          changes.detailed?.trim() || proposal.detailed,
          { client },
        );
      }
    } catch (error) {
      if (
        error instanceof BudgetError ||
        error instanceof GoalError ||
        error instanceof CategoryError
      ) {
        throw new ProposalError(error.message);
      }
      throw error;
    }
  }
  await db.planProposals.updateMany({
    where: { id: row.id, status: "open" },
    data: { status: accept ? "accepted" : "dismissed", answeredAt: now },
  });
  await logAudit(
    { type: "user", id: userId },
    "proposal_answered",
    { type: "user", id: userId },
    {
      kind: proposal.kind,
      accepted: accept,
      changed: Object.values(changes).some((v) => Boolean(v?.trim())),
    },
  );
  await track(userId, accept ? "proposal_accepted" : "proposal_dismissed", {
    kind: proposal.kind,
  });
}
