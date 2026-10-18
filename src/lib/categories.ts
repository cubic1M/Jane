import { PFC_TAXONOMY, categoryOf, type PfcPrimary } from "@/categorize/taxonomy";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { PrismaClient } from "@/generated/prisma/client";
import { categoryLabel } from "@/insights/labels";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// Category corrections: the person fixes one transaction's category, and optionally makes
// it the rule for that merchant, past and future. Rules are stored as the person's own
// merchant_categories rows (source "user"), which categorizeTransactions applies before
// anything else, so they survive every later sync and import.

type Options = { client?: PrismaClient };

export class CategoryError extends Error {}

// "FOOD_AND_DRINK_GROCERIES" -> "Groceries".
export function detailedLabel(primary: string, detailed: string): string {
  const rest = detailed.startsWith(`${primary}_`) ? detailed.slice(primary.length + 1) : detailed;
  const words = rest.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Every category, grouped under the plain names insights uses.
export function categoryOptions() {
  return (Object.keys(PFC_TAXONOMY) as PfcPrimary[])
    .map((primary) => ({
      label: categoryLabel(primary),
      options: PFC_TAXONOMY[primary].map((detailed) => ({
        value: detailed as string,
        label: detailedLabel(primary, detailed),
      })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// The merchant a rule is keyed by: the same key categorizeTransactions looks up.
export const merchantRuleKey = (description: string) => normalizeMerchant(description)?.key ?? null;

export async function correctCategory(
  userId: string,
  transactionId: string,
  detailed: string,
  { forMerchant = false, client = defaultClient }: Options & { forMerchant?: boolean } = {},
): Promise<{ updated: number }> {
  const category = categoryOf(detailed);
  if (!category) throw new CategoryError("Pick a category from the list.");
  const db = scopedFor(userId, client);
  const transaction = await db.transactions.findFirst({
    where: { id: transactionId },
    select: { id: true, description: true },
  });
  if (!transaction) throw new CategoryError("That transaction doesn't exist.");
  const data = {
    pfcPrimary: category.primary,
    pfcDetailed: category.detailed,
    categorySource: "user" as const,
  };

  const key = forMerchant ? merchantRuleKey(transaction.description) : null;
  if (!key) {
    await db.transactions.updateMany({ where: { id: transaction.id }, data });
    return { updated: 1 };
  }
  return setMerchantCategory(userId, key, detailed, { client });
}

// Every transaction at one merchant, now and later, goes in this category.
export async function setMerchantCategory(
  userId: string,
  key: string,
  detailed: string,
  { client = defaultClient }: Options = {},
): Promise<{ updated: number }> {
  const category = categoryOf(detailed);
  if (!category) throw new CategoryError("Pick a category from the list.");
  const db = scopedFor(userId, client);
  const data = {
    pfcPrimary: category.primary,
    pfcDetailed: category.detailed,
    categorySource: "user" as const,
  };
  await db.merchantCategories.upsert({
    where: { userId_merchantKey: { userId, merchantKey: key } },
    create: {
      userId,
      merchantKey: key,
      pfcPrimary: category.primary,
      pfcDetailed: category.detailed,
      source: "user",
    },
    update: { pfcPrimary: category.primary, pfcDetailed: category.detailed, source: "user" },
  });
  // Past transactions at the same merchant. Only this person's, through the scoped client.
  const all = await db.transactions.findMany({ select: { id: true, description: true } });
  const ids = all.filter((t) => merchantRuleKey(t.description) === key).map((t) => t.id);
  const { count } = await db.transactions.updateMany({ where: { id: { in: ids } }, data });
  return { updated: count };
}

export async function listMerchantRules(userId: string, { client = defaultClient }: Options = {}) {
  return scopedFor(userId, client).merchantCategories.findMany({
    where: { source: "user" },
    select: { merchantKey: true, pfcPrimary: true, pfcDetailed: true },
    orderBy: { merchantKey: "asc" },
  });
}

// Stops applying a rule to new transactions. Ones it already changed keep their category.
export async function removeMerchantRule(
  userId: string,
  merchantKey: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).merchantCategories.deleteMany({
    where: { merchantKey, source: "user" },
  });
}
