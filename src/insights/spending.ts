import { FULL_MONTH_START_SLACK_DAYS } from "@/config/budgets";
import { NON_SPENDING_CATEGORIES, NON_SPENDING_PRIMARIES } from "@/config/detection";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { RepeatMark } from "@/lib/recurring-marks";
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
  // Categories whose refunds came to more than was bought that month (negative cents). They
  // count in the month's spending, so the breakdown lists them too (debugger 11-02).
  refundsByMonth: Record<string, CategoryTotal[]>;
  topMerchants: MerchantTotal[];
  // The newest month with spending compared with the one before, biggest changes first.
  changes: CategoryChange[];
  // Which two months those are; null with only one month.
  changeMonths: { before: string; after: string } | null;
};

const TOP_MERCHANTS = 10;
const TOP_CHANGES = 5;

type Kinded = Pick<InsightTransaction, "pending" | "pfcPrimary" | "pfcDetailed" | "amountCents">;

function isMovingMoney(t: Kinded): boolean {
  return (
    (t.pfcPrimary !== null &&
      (NON_SPENDING_PRIMARIES as readonly string[]).includes(t.pfcPrimary)) ||
    (t.pfcDetailed !== null &&
      (NON_SPENDING_CATEGORIES as readonly string[]).includes(t.pfcDetailed))
  );
}

export type Kind = "income" | "spending" | "ignored";

export function kindOf(t: Kinded): Kind {
  if (t.pending || isMovingMoney(t)) return "ignored";
  if (t.pfcPrimary === "INCOME") return t.amountCents < 0 ? "income" : "ignored";
  // Money in with no category isn't a refund: an unknown deposit (pay the rules don't know, a
  // loan, student aid) took a month's spending below $0 (night debugger, 10-30).
  if (t.pfcPrimary === null && t.amountCents < 0) return "ignored";
  // Outflows are spending; inflows in a spending category are refunds, which net against it.
  return "spending";
}

// The month a "spent this month" figure shows: the newest with spending, so on the 1st (nothing
// spent yet, maybe a paycheck in) or for an old upload it's the last month there was any, said by
// name. The one rule for Home's Money tile, the Money page's tree and the money hub (gate B: the
// tile went back a month only when the one before had spending, the tree to the newest month with a
// paycheck, the hub never, so the 1st showed three different months).
export const shownSpendingMonth = <T extends { spendingCents: number }>(
  months: readonly T[],
): T | undefined => months.findLast((m) => m.spendingCents > 0) ?? months.at(-1);

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
function merchantOf(t: InsightTransaction): string {
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

  const refundsByMonth = Object.fromEntries(
    months.map((m) => [
      m,
      [...byCategory.get(m)!]
        .filter(([, cents]) => cents < 0)
        .map(([category, cents]) => ({ category, cents }))
        .sort((a, b) => a.cents - b.cents),
    ]),
  );

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
  const [compared, after] = end >= 2 ? months.slice(end - 2, end) : [];
  // Only against a month the data covers (nearly) whole, as typical-month.ts's fullMonths: a
  // statement from Oct 17 has no October rent, so November's read "Rent and utilities is up +$935"
  // (debug 2, 11-16).
  const first = transactions.reduce<string | null>(
    (min, t) => (min === null || t.date < min ? t.date : min),
    null,
  );
  const covered = (month: string) => {
    const start = new Date(`${month}-01T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() + FULL_MONTH_START_SLACK_DAYS);
    return first !== null && first <= start.toISOString().slice(0, 10);
  };
  const before = compared && covered(compared) ? compared : undefined;
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
    refundsByMonth,
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
  // The recurring charge it is, when the page asks for marks (src/lib/recurring-marks.ts).
  repeat?: RepeatMark | null;
};

// Every transaction spendingInsights counts as spending in the range, newest first.
export function spendingLines(
  transactions: InsightTransaction[],
  {
    asOf,
    monthCount,
    accountNames = new Map(),
    repeatOf,
  }: {
    asOf: string;
    monthCount: number;
    accountNames?: ReadonlyMap<string, string>;
    repeatOf?: (t: InsightTransaction) => RepeatMark | null;
  },
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
      ...(repeatOf ? { repeat: t.amountCents > 0 ? repeatOf(t) : null } : {}),
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
