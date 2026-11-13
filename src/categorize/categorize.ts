import type Anthropic from "@anthropic-ai/sdk";
import { NOT_A_REFUND_MIN_CENTS } from "@/config/detection";
import { classifyMerchants } from "./llm";
import { categorizeByRules, payoutByRules } from "./rules";
import { categoryOf, type Category } from "./taxonomy";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { NormalizedTransaction } from "@/data-sources/types";
import type { ScopedDb } from "@/lib/db-scoped";
import { isTrialUser } from "@/lib/trial-ids";

type CategorySource = "rule" | "llm" | "plaid" | "user";

// Money out that isn't buying something, so money in at the same name isn't a refund of it.
const NOT_PURCHASES: readonly string[] = ["LOAN_PAYMENTS", "TRANSFER_OUT", "TRANSFER_IN", "INCOME"];
const REFUND_CATCH_ALL = categoryOf("GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE");

export type Categorized<T> = T & {
  category: Category | null;
  categorySource: CategorySource | null;
};

type Db = Pick<ScopedDb, "userId" | "merchantCategories">;

// The person's own merchant rules first, then Plaid's category, then keyword rules, then
// the LLM for whatever is left, cached per merchant so each merchant is only ever sent
// once per user. `askClaude: false` stops at the cache: an upload is answered at once and
// categorizeLeftovers asks about the rest after the response (founder: imports were slow).
// A sample person never asks: anyone can make one, so their scan can't cost anything.
export async function categorizeTransactions<T extends NormalizedTransaction>(
  transactions: T[],
  db: Db,
  { askClaude = true, claude }: { askClaude?: boolean; claude?: () => Anthropic } = {},
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

  const firstPass: Categorized<T>[] = transactions.map((transaction) => {
    const key = merchantKeyOf(transaction);
    const fromUser = key ? userRules.get(key) : undefined;
    if (fromUser) return { ...transaction, category: fromUser, categorySource: "user" };
    const fromSource = transaction.categoryDetailed
      ? categoryOf(transaction.categoryDetailed)
      : null;
    // A payout the bank filed as a transfer (or anything but income) is income (./rules.ts).
    const payout = fromSource?.primary === "INCOME" ? null : payoutByRules(transaction);
    if (fromSource && payout) return { ...transaction, category: payout, categorySource: "rule" };
    if (fromSource) return { ...transaction, category: fromSource, categorySource: "plaid" };
    const fromRules = categorizeByRules(transaction);
    if (fromRules) return { ...transaction, category: fromRules, categorySource: "rule" };
    return { ...transaction, category: null, categorySource: null };
  });

  const results = withRefundsOfCharges(firstPass, merchantKeyOf);

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

  const toAsk =
    askClaude && !isTrialUser(db.userId) ? [...unplaced].filter((key) => !known.has(key)) : [];
  const answers = await classifyMerchants(toAsk, { claude });
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
    // Claude's answer is what a typical purchase there is. A big deposit isn't a refund of one: it's
    // a client paying, and money in with no category doesn't net against spending (debugger 11-02).
    if (result.amountCents <= -NOT_A_REFUND_MIN_CENTS) return result;
    const key = merchantKeyOf(result);
    const category = key ? known.get(key) : undefined;
    return category ? { ...result, category, categorySource: "llm" } : result;
  });
}

// Money in at a merchant, no bigger than a charge there, is a refund of it, in that charge's most
// common category (else the catch-all, so that it nets), unless it's too big to be one
// (NOT_A_REFUND_MIN_CENTS). The same statement must give the same totals however a bank words its
// columns (src/accuracy/metamorphic): a refund under Capital One's "Payment/Credit" read as paying
// the card, and a refund with no category counted nowhere, so its charge stayed in spending.
function withRefundsOfCharges<T extends NormalizedTransaction>(
  results: Categorized<T>[],
  keyOf: (t: T) => string | null,
): Categorized<T>[] {
  const charges = new Map<string, Categorized<T>[]>();
  for (const r of results) {
    const key = keyOf(r);
    if (!key || r.amountCents <= 0 || NOT_PURCHASES.includes(r.category?.primary ?? "")) continue;
    charges.set(key, [...(charges.get(key) ?? []), r]);
  }
  return results.map((r) => {
    const rows = charges.get(keyOf(r) ?? "");
    const unplaced = !r.category || r.category.detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
    if (!rows || r.amountCents >= 0 || !unplaced || r.categorySource === "user") return r;
    if (r.categorySource === "plaid" || r.amountCents <= -NOT_A_REFUND_MIN_CENTS) return r;
    if (!rows.some((c) => c.date <= r.date && c.amountCents >= -r.amountCents)) return r;
    return { ...r, category: mostCommonCategory(rows) ?? REFUND_CATCH_ALL, categorySource: "rule" };
  });
}

function mostCommonCategory(rows: readonly { category: Category | null }[]): Category | null {
  const counts = new Map<string, { category: Category; n: number }>();
  for (const { category } of rows) {
    if (!category) continue;
    const entry = counts.get(category.detailed) ?? { category, n: 0 };
    counts.set(category.detailed, { ...entry, n: entry.n + 1 });
  }
  const [top] = [...counts.values()].sort(
    (a, b) => b.n - a.n || a.category.detailed.localeCompare(b.category.detailed),
  );
  return top?.category ?? null;
}

// After an upload: the person's transactions no rule placed, sorted by Claude (the cache
// first, so a merchant is asked about once), and stored. Returns how many rows changed.
export async function categorizeLeftovers(
  db: Pick<ScopedDb, "userId" | "merchantCategories" | "transactions">,
  { claude }: { claude?: () => Anthropic } = {},
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
    { claude },
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
