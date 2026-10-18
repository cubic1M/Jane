import { MAX_BUDGET_CENTS } from "@/config/budgets";
import { CATEGORY_LABELS, UNCATEGORIZED } from "@/insights/labels";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { parseMoneyToCents } from "@/lib/money";

// Setting and removing the person's budgets.

type Options = { client?: PrismaClient };

export class BudgetError extends Error {}

// Spending categories a budget can be for: the names insights uses, minus money moving in.
const NOT_SPENDING = new Set(["INCOME", "TRANSFER_IN", "LOAN_DISBURSEMENTS"]);
export const BUDGET_CATEGORIES: readonly string[] = [
  ...Object.entries(CATEGORY_LABELS)
    .filter(([primary]) => !NOT_SPENDING.has(primary))
    .map(([, label]) => label),
  UNCATEGORIZED,
].sort();

export async function setBudget(
  userId: string,
  category: string,
  amount: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  if (!BUDGET_CATEGORIES.includes(category)) throw new BudgetError("Pick a category.");
  const cents = parseMoneyToCents(amount);
  if (cents === null || cents <= 0 || cents > MAX_BUDGET_CENTS) {
    throw new BudgetError("Enter a monthly amount, like 400.");
  }
  await scopedFor(userId, client).budgets.upsert({
    where: { userId_category: { userId, category } },
    create: { userId, category, amountCents: cents },
    update: { amountCents: cents },
  });
}

export async function removeBudget(
  userId: string,
  category: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).budgets.deleteMany({ where: { category } });
}
