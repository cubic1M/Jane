import { NON_SPENDING_CATEGORIES, NON_SPENDING_PRIMARIES } from "@/config/detection";
import { normalizeMerchant } from "@/data-sources/merchant";
import { categoryLabel } from "./labels";

// Where money goes, month by month. Pure: transactions in, totals out. Amounts follow
// Plaid (positive is money out). Money moved between the person's own accounts (transfers,
// card payments, loan money in) isn't spending or income, so nothing is counted twice;
// refunds reduce spending in their category.

export type InsightTransaction = {
  date: string;
  amountCents: number;
  description: string;
  merchantName: string | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  pending: boolean;
  // Only the insights page reads these, to list the transactions behind each row.
  id?: string;
  accountId?: string;
};

export type MonthTotals = { month: string; spendingCents: number; incomeCents: number };
export type CategoryTotal = { category: string; cents: number };
export type MerchantTotal = { merchant: string; cents: number; count: number };
export type CategoryChange = {
  category: string;
  beforeCents: number;
  afterCents: number;
  changeCents: number;
};

export type SpendingInsights = {
  months: MonthTotals[];
  // Spending by category in each month, largest first.
  categoriesByMonth: Record<string, CategoryTotal[]>;
  topMerchants: MerchantTotal[];
  // The newest month with spending compared with the one before, biggest changes first.
  changes: CategoryChange[];
  // Which two months those are; null with only one month.
  changeMonths: { before: string; after: string } | null;
};

const TOP_MERCHANTS = 10;
const TOP_CHANGES = 5;

function isMovingMoney(t: InsightTransaction): boolean {
  return (
    (t.pfcPrimary !== null &&
      (NON_SPENDING_PRIMARIES as readonly string[]).includes(t.pfcPrimary)) ||
    (t.pfcDetailed !== null &&
      (NON_SPENDING_CATEGORIES as readonly string[]).includes(t.pfcDetailed))
  );
}

export type Kind = "income" | "spending" | "ignored";

export function kindOf(t: InsightTransaction): Kind {
  if (t.pending || isMovingMoney(t)) return "ignored";
  if (t.pfcPrimary === "INCOME") return t.amountCents < 0 ? "income" : "ignored";
  // Money in with no category isn't a refund: an unknown deposit (pay the rules don't know, a
  // loan, student aid) took a month's spending below $0 (night debugger, 10-30).
  if (t.pfcPrimary === null && t.amountCents < 0) return "ignored";
  // Outflows are spending; inflows in a spending category are refunds, which net against it.
  return "spending";
}

// The `count` months ending with the month of `asOf`, oldest first, as YYYY-MM.
export function monthsEnding(asOf: string, count: number): string[] {
  const [year, month] = asOf.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

const sortDesc = <T extends { cents: number }>(rows: T[]) =>
  rows.sort((a, b) => b.cents - a.cents || JSON.stringify(a).localeCompare(JSON.stringify(b)));

// The clean merchant name a transaction is counted under.
export function merchantOf(t: InsightTransaction): string {
  return t.merchantName ?? normalizeMerchant(t.description)?.name ?? t.description;
}

export function spendingInsights(
  transactions: InsightTransaction[],
  { asOf, monthCount }: { asOf: string; monthCount: number },
): SpendingInsights {
  const months = monthsEnding(asOf, monthCount);
  const inRange = new Set(months);
  const totals = new Map(months.map((m) => [m, { month: m, spendingCents: 0, incomeCents: 0 }]));
  const byCategory = new Map<string, Map<string, number>>(months.map((m) => [m, new Map()]));
  const merchants = new Map<string, MerchantTotal>();

  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    if (!inRange.has(month)) continue;
    const kind = kindOf(t);
    if (kind === "ignored") continue;
    const monthTotals = totals.get(month)!;
    if (kind === "income") {
      monthTotals.incomeCents += -t.amountCents;
      continue;
    }
    const category = categoryLabel(t.pfcPrimary);
    const categories = byCategory.get(month)!;
    categories.set(category, (categories.get(category) ?? 0) + t.amountCents);

    const merchant = merchantOf(t);
    const row = merchants.get(merchant) ?? { merchant, cents: 0, count: 0 };
    row.cents += t.amountCents;
    if (t.amountCents > 0) row.count += 1;
    merchants.set(merchant, row);
  }

  // Refunds net against the month's spending (a flight bought in August, refunded in September),
  // but a month's spending never goes below $0 (night debugger, 10-30).
  for (const [month, categories] of byCategory) {
    const net = [...categories.values()].reduce((sum, cents) => sum + cents, 0);
    totals.get(month)!.spendingCents = Math.max(0, net);
  }

  const categoriesByMonth = Object.fromEntries(
    months.map((m) => [
      m,
      sortDesc(
        [...byCategory.get(m)!]
          .filter(([, cents]) => cents > 0)
          .map(([category, cents]) => ({ category, cents })),
      ),
    ]),
  );

  // The newest month with spending against the one before it; with only one month there's
  // nothing to compare. On the 1st, this month has nothing yet: comparing it made every
  // category "down" by all of last month (debugger 11-01).
  const newest = months.findLastIndex((m) => totals.get(m)!.spendingCents > 0);
  const end = newest >= 1 ? newest + 1 : months.length;
  const [before, after] = end >= 2 ? months.slice(end - 2, end) : [];
  const changes = before
    ? [...new Set([...byCategory.get(before)!.keys(), ...byCategory.get(after)!.keys()])]
        .map((category) => {
          const beforeCents = Math.max(0, byCategory.get(before)!.get(category) ?? 0);
          const afterCents = Math.max(0, byCategory.get(after)!.get(category) ?? 0);
          return { category, beforeCents, afterCents, changeCents: afterCents - beforeCents };
        })
        .filter((c) => c.changeCents !== 0)
        .sort(
          (a, b) =>
            Math.abs(b.changeCents) - Math.abs(a.changeCents) ||
            a.category.localeCompare(b.category),
        )
        .slice(0, TOP_CHANGES)
    : [];

  return {
    months: [...totals.values()],
    categoriesByMonth,
    topMerchants: sortDesc([...merchants.values()].filter((m) => m.cents > 0)).slice(
      0,
      TOP_MERCHANTS,
    ),
    changes,
    changeMonths: before ? { before, after } : null,
  };
}

// One spending transaction behind a row of the insights page. Refunds are negative, so a row's
// lines add up to exactly its total.
export type SpendingLine = {
  date: string;
  merchant: string;
  account: string;
  cents: number;
  category: string;
};

// Every transaction spendingInsights counts as spending in the range, newest first.
export function spendingLines(
  transactions: InsightTransaction[],
  {
    asOf,
    monthCount,
    accountNames = new Map(),
  }: { asOf: string; monthCount: number; accountNames?: ReadonlyMap<string, string> },
): SpendingLine[] {
  const inRange = new Set(monthsEnding(asOf, monthCount));
  return transactions
    .filter((t) => inRange.has(t.date.slice(0, 7)) && kindOf(t) === "spending")
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.amountCents - a.amountCents ||
        (a.id ?? "").localeCompare(b.id ?? ""),
    )
    .map((t) => ({
      date: t.date,
      merchant: merchantOf(t),
      account: (t.accountId && accountNames.get(t.accountId)) || "",
      cents: t.amountCents,
      category: categoryLabel(t.pfcPrimary),
    }));
}

// The lines behind one row: a category in a month, or a merchant over the whole range.
export function linesFor(
  lines: readonly SpendingLine[],
  { month, category, merchant }: { month?: string; category?: string; merchant?: string },
): SpendingLine[] {
  return lines.filter(
    (l) =>
      (month === undefined || l.date.startsWith(month)) &&
      (category === undefined || l.category === category) &&
      (merchant === undefined || l.merchant === merchant),
  );
}
