import {
  ONE_OFF_MIN_CENTS,
  ONE_OFF_NEVER_DETAILED,
  ONE_OFF_PRIMARIES,
  ONE_OFF_REPEAT_SHARE,
  ONE_OFF_SHARE,
} from "@/config/detection";
import { FULL_MONTH_START_SLACK_DAYS } from "@/config/budgets";
import { normalizeMerchant } from "@/data-sources/merchant";
import { formatCents } from "@/lib/money";
import { kindOf, monthsEnding, spendingInsights, type InsightTransaction } from "./spending";

// A typical month (books QA): the Reyes' $36,000 of flood repairs in September made their
// "monthly spending" about $14,900 instead of about $8,600, which left their year plan no room
// and their health score no margin. One-off charges are found here, once, and left out of
// every monthly spending figure Jane averages; each figure that leaves one out says so. Pure.

export type OneOff = {
  date: string;
  month: string;
  merchant: string;
  amountCents: number;
};

const merchantOf = (t: InsightTransaction) =>
  t.merchantName ?? normalizeMerchant(t.description)?.name ?? t.description;

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const canBeOneOff = (t: InsightTransaction) =>
  t.pfcPrimary !== null &&
  ONE_OFF_PRIMARIES.includes(t.pfcPrimary) &&
  !(t.pfcDetailed !== null && ONE_OFF_NEVER_DETAILED.includes(t.pfcDetailed));

// The one-off charges among `transactions` up to `asOf`, judged against the median of the full
// months before it (the usual month). Pass as much history as there is: a merchant charged
// again in it isn't a one-off.
export function oneOffCharges(transactions: InsightTransaction[], asOf: string): OneOff[] {
  const spending = transactions.filter((t) => t.date <= asOf && kindOf(t) === "spending");
  if (spending.length === 0) return [];
  const first = spending.reduce((m, t) => (t.date < m ? t.date : m), spending[0].date);
  const [fy, fm] = first.split("-").map(Number);
  const [ay, am] = asOf.split("-").map(Number);
  const span = (ay - fy) * 12 + (am - fm) + 1;
  const full = spendingInsights(transactions, { asOf, monthCount: span }).months.slice(0, -1);
  // Without a full month there's no usual month to judge by.
  const months = full.map((m) => m.spendingCents).filter((c) => c > 0);
  if (months.length === 0) return [];
  const usual = median(months);
  const floor = Math.max(ONE_OFF_MIN_CENTS, Math.round(usual * ONE_OFF_SHARE));
  const big = spending.filter((t) => t.amountCents >= floor && canBeOneOff(t));
  return big
    .filter((t) => {
      const merchant = merchantOf(t);
      return !spending.some(
        (o) =>
          o !== t &&
          merchantOf(o) === merchant &&
          o.amountCents >= t.amountCents * ONE_OFF_REPEAT_SHARE,
      );
    })
    .map((t) => ({
      date: t.date,
      month: t.date.slice(0, 7),
      merchant: merchantOf(t),
      amountCents: t.amountCents,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents);
}

// The transactions without their one-offs, for any monthly spending figure.
export function withoutOneOffs<T extends InsightTransaction>(
  transactions: T[],
  oneOffs: readonly OneOff[],
): T[] {
  if (oneOffs.length === 0) return transactions;
  const left = [...oneOffs];
  return transactions.filter((t) => {
    const i = left.findIndex(
      (o) => o.date === t.date && o.amountCents === t.amountCents && o.merchant === merchantOf(t),
    );
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
}

// The transactions of a typical month: one-offs up to `asOf` left out.
export const typicalOf = <T extends InsightTransaction>(transactions: T[], asOf: string): T[] =>
  withoutOneOffs(transactions, oneOffCharges(transactions, asOf));

// Typical spending over the `months` complete months before the one `asOf` falls in, one-offs
// left out: the one monthly-spend figure the drafted goals, the emergency fund, the cash page and
// the refund plan use (docs/feature-audit.md, cluster 13). Pass transactions covering at least
// months + 1 (more history finds one-offs better).
// The months (YYYY-MM) the transactions cover from (about) their first day: a month the data
// starts partway through is mostly missing, not a quiet month.
export function fullMonths(
  months: readonly string[],
  transactions: readonly { date: string }[],
): string[] {
  const first = transactions.reduce<string | null>(
    (min, t) => (min === null || t.date < min ? t.date : min),
    null,
  );
  if (first === null) return [];
  return months.filter((m) => {
    const start = new Date(`${m}-01T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() + FULL_MONTH_START_SLACK_DAYS);
    return first <= start.toISOString().slice(0, 10);
  });
}

export function typicalMonthlySpending(
  transactions: InsightTransaction[],
  asOf: string,
  months: number,
): number {
  const clean = withoutOneOffs(transactions, oneOffCharges(transactions, asOf));
  const covered = new Set(fullMonths(monthsEnding(asOf, months + 1), transactions));
  const complete = spendingInsights(clean, { asOf, monthCount: months + 1 })
    .months.slice(0, -1)
    .filter((m) => covered.has(m.month));
  return complete.length === 0
    ? 0
    : Math.round(complete.reduce((sum, m) => sum + m.spendingCents, 0) / complete.length);
}

// One line on what was left out of a monthly figure, or null when nothing was.
export function oneOffNote(oneOffs: readonly OneOff[], months?: readonly string[]): string | null {
  const shown = months ? oneOffs.filter((o) => months.includes(o.month)) : oneOffs;
  if (shown.length === 0) return null;
  const total = shown.reduce((s, o) => s + o.amountCents, 0);
  const names = [...new Set(shown.map((o) => o.month))].map((m) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
  );
  const list = shown.map((o) => `${o.merchant} ${formatCents(o.amountCents)}`).join(", ");
  return `${names.join(" and ")} ${names.length === 1 ? "was" : "were"} unusual: ${formatCents(total)} of one-off costs (${list}) ${shown.length === 1 ? "is" : "are"} left out, so this is a typical month.`;
}
