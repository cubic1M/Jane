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
  // The latest month compared with the one before, biggest changes first.
  changes: CategoryChange[];
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
    monthTotals.spendingCents += t.amountCents;
    const category = categoryLabel(t.pfcPrimary);
    const categories = byCategory.get(month)!;
    categories.set(category, (categories.get(category) ?? 0) + t.amountCents);

    const merchant = t.merchantName ?? normalizeMerchant(t.description)?.name ?? t.description;
    const row = merchants.get(merchant) ?? { merchant, cents: 0, count: 0 };
    row.cents += t.amountCents;
    if (t.amountCents > 0) row.count += 1;
    merchants.set(merchant, row);
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

  // The last two months compared; with only one month there's nothing to compare.
  const [before, after] = months.length >= 2 ? months.slice(-2) : [];
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
  };
}
