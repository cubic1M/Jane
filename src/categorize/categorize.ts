import { classifyMerchants } from "./llm";
import { categorizeByRules } from "./rules";
import { categoryOf, type Category } from "./taxonomy";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { NormalizedTransaction } from "@/data-sources/types";
import type { ScopedDb } from "@/lib/db-scoped";

export type CategorySource = "rule" | "llm" | "plaid" | "user";

export type Categorized<T> = T & {
  category: Category | null;
  categorySource: CategorySource | null;
};

type Db = Pick<ScopedDb, "userId" | "merchantCategories">;

// The person's own merchant rules first, then Plaid's category, then keyword rules, then
// the LLM for whatever is left, cached per merchant so each merchant is only ever sent
// once per user. `askClaude: false` stops at the cache: an upload is answered at once and
// categorizeLeftovers asks about the rest after the response (founder: imports were slow).
export async function categorizeTransactions<T extends NormalizedTransaction>(
  transactions: T[],
  db: Db,
  { askClaude = true }: { askClaude?: boolean } = {},
): Promise<Categorized<T>[]> {
  const merchantKeyOf = (t: T) => normalizeMerchant(t.description)?.key ?? null;
  const keys = [...new Set(transactions.map(merchantKeyOf).filter((k) => k !== null))];
  const userRules = new Map<string, Category>();
  if (keys.length > 0) {
    const rules = await db.merchantCategories.findMany({
      where: { merchantKey: { in: keys }, source: "user" },
    });
    for (const rule of rules) {
      const category = categoryOf(rule.pfcDetailed);
      if (category) userRules.set(rule.merchantKey, category);
    }
  }

  const results: Categorized<T>[] = transactions.map((transaction) => {
    const key = merchantKeyOf(transaction);
    const fromUser = key ? userRules.get(key) : undefined;
    if (fromUser) return { ...transaction, category: fromUser, categorySource: "user" };
    const fromSource = transaction.categoryDetailed
      ? categoryOf(transaction.categoryDetailed)
      : null;
    if (fromSource) return { ...transaction, category: fromSource, categorySource: "plaid" };
    const fromRules = categorizeByRules(transaction);
    if (fromRules) return { ...transaction, category: fromRules, categorySource: "rule" };
    return { ...transaction, category: null, categorySource: null };
  });

  const unplaced = new Set(
    results.flatMap((r) => (r.category ? [] : [merchantKeyOf(r)])).filter((k) => k !== null),
  );
  if (unplaced.size === 0) return results;

  const known = new Map<string, Category>();
  const cached = await db.merchantCategories.findMany({
    where: { merchantKey: { in: [...unplaced] } },
  });
  for (const row of cached) {
    const category = categoryOf(row.pfcDetailed);
    if (category) known.set(row.merchantKey, category);
  }

  const toAsk = askClaude ? [...unplaced].filter((key) => !known.has(key)) : [];
  const answers = await classifyMerchants(toAsk);
  if (answers.size > 0) {
    const rows = [...answers].flatMap(([merchantKey, detailed]) => {
      const category = categoryOf(detailed);
      if (!category) return [];
      known.set(merchantKey, category);
      return [
        {
          userId: db.userId,
          merchantKey,
          pfcPrimary: category.primary,
          pfcDetailed: category.detailed,
          source: "llm" as const,
        },
      ];
    });
    await db.merchantCategories.createMany({ data: rows, skipDuplicates: true });
  }

  return results.map((result) => {
    if (result.category) return result;
    const key = merchantKeyOf(result);
    const category = key ? known.get(key) : undefined;
    return category ? { ...result, category, categorySource: "llm" } : result;
  });
}

// After an upload: the person's transactions no rule placed, sorted by Claude (the cache
// first, so a merchant is asked about once), and stored. Returns how many rows changed.
export async function categorizeLeftovers(
  db: Pick<ScopedDb, "userId" | "merchantCategories" | "transactions">,
): Promise<number> {
  const rows = await db.transactions.findMany({
    where: { pfcDetailed: null, categorySource: null },
    select: { id: true, accountId: true, date: true, description: true, amountCents: true },
  });
  if (rows.length === 0) return 0;
  const categorized = await categorizeTransactions(
    rows.map((r) => ({
      accountRef: r.accountId,
      date: r.date.toISOString().slice(0, 10),
      amountCents: r.amountCents,
      description: r.description,
      merchantName: null,
      categoryPrimary: null,
      categoryDetailed: null,
      pending: false,
      externalId: r.id,
      hints: {},
    })),
    db,
  );
  // One update per category, not per row.
  const byCategory = new Map<string, { category: Category; ids: string[] }>();
  for (const row of categorized) {
    if (!row.category || row.categorySource !== "llm") continue;
    const entry = byCategory.get(row.category.detailed) ?? { category: row.category, ids: [] };
    entry.ids.push(row.externalId);
    byCategory.set(row.category.detailed, entry);
  }
  let changed = 0;
  for (const { category, ids } of byCategory.values()) {
    const { count } = await db.transactions.updateMany({
      where: { id: { in: ids }, pfcDetailed: null },
      data: { pfcPrimary: category.primary, pfcDetailed: category.detailed, categorySource: "llm" },
    });
    changed += count;
  }
  return changed;
}
