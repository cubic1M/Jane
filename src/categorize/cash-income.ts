import {
  CASH_INCOME_CATEGORIES,
  CASH_INCOME_MAX_AMOUNT_CV,
  CASH_INCOME_MAX_GAP_CV,
  CASH_INCOME_MAX_MEDIAN_GAP_DAYS,
  CASH_INCOME_MIN_DEPOSITS,
  CASH_INCOME_MIN_SPAN_DAYS,
  CASH_INCOME_ONE_OFF_FACTOR,
} from "@/config/detection";
import { DAYS_PER_MONTH } from "@/detection/units";
import { DAY_MS, isoDay } from "@/lib/dates";
import type { ScopedDb } from "@/lib/db-scoped";
import { confidenceOf } from "@/profile/confidence";

// Cash deposits as income (founder, 10-30). Plaid and the keyword rules call cash paid in moved
// money (TRANSFER_IN_DEPOSIT), so a server who lives on tips read as earning half of what they
// do, and the forecast ran short. Deposits that come back regularly, at a similar cadence or of
// similar amounts, are income; a one-off (a car sold for cash) isn't. Like the card payments
// matched by timing (./card-payments.ts), the rows are re-sorted where they're stored, so every
// page, figure and forecast that reads INCOME agrees. The person can say "not income": the rows
// become theirs (categorySource user), and no deposit is counted again until they undo it.

const INCOME = { pfcPrimary: "INCOME", pfcDetailed: "INCOME_OTHER" } as const;
const DEPOSIT = { pfcPrimary: "TRANSFER_IN", pfcDetailed: "TRANSFER_IN_DEPOSIT" } as const;

export type DepositRow = {
  id: string;
  date: string;
  // Plaid's sign: money in is negative.
  amountCents: number;
  pfcDetailed: string | null;
  categorySource: string | null;
};

export type CashIncome = { ids: string[]; percent: number };

const isDeposit = (r: DepositRow) =>
  r.amountCents < 0 &&
  (r.categorySource === "cash_income" ||
    (r.pfcDetailed !== null &&
      (CASH_INCOME_CATEGORIES as readonly string[]).includes(r.pfcDetailed)));

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// How much the values vary, as a share of their average.
const spread = (xs: number[]) => {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  if (mean === 0) return Infinity;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / mean;
};

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

// The person said these deposits aren't income.
export function saidNotIncome(rows: readonly DepositRow[]): boolean {
  return rows.some((r) => isDeposit(r) && r.categorySource === "user");
}

// The cash deposits that are income, and how sure, from `months` of statements; null when they
// don't come back regularly. Whoever sorted them, so the same deposits give the same answer.
export function regularCashDeposits(
  rows: readonly DepositRow[],
  months: number,
): CashIncome | null {
  const deposits = rows.filter(isDeposit);
  if (deposits.length === 0) return null;
  const usual = median(deposits.map((d) => -d.amountCents));
  const kept = deposits
    .filter((d) => -d.amountCents <= usual * CASH_INCOME_ONE_OFF_FACTOR)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (kept.length < CASH_INCOME_MIN_DEPOSITS) return null;

  // Two deposits on one day are one visit to the bank.
  const days = [...new Set(kept.map((d) => dayNumber(d.date)))];
  if (days.length < 2 || days.at(-1)! - days[0] < CASH_INCOME_MIN_SPAN_DAYS) return null;
  const gaps = days.slice(1).map((d, i) => d - days[i]);
  if (median(gaps) > CASH_INCOME_MAX_MEDIAN_GAP_DAYS) return null;
  const regular =
    spread(gaps) <= CASH_INCOME_MAX_GAP_CV ||
    spread(kept.map((d) => -d.amountCents)) <= CASH_INCOME_MAX_AMOUNT_CV;
  if (!regular) return null;

  return {
    ids: kept.map((d) => d.id),
    percent: confidenceOf("seen", { months, matches: kept.length }),
  };
}

const SELECT = {
  id: true,
  date: true,
  amountCents: true,
  pfcDetailed: true,
  categorySource: true,
} as const;

async function loadDeposits(db: Pick<ScopedDb, "transactions">) {
  const [rows, first, last] = await Promise.all([
    db.transactions.findMany({
      where: {
        pending: false,
        amountCents: { lt: 0 },
        OR: [
          { pfcDetailed: { in: [...CASH_INCOME_CATEGORIES] } },
          { categorySource: "cash_income" },
        ],
      },
      select: SELECT,
    }),
    db.transactions.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
    db.transactions.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
  ]);
  const months =
    first && last
      ? Math.max(
          0,
          Math.round((last.date.getTime() - first.date.getTime()) / DAY_MS / DAYS_PER_MONTH),
        )
      : 0;
  return { rows: rows.map((r) => ({ ...r, date: isoDay(r.date) })), months };
}

// Re-sorts the stored deposits: regular ones to income, any that stopped being regular back to
// deposits. Runs after an import and a bank sync, before detection. Returns how many changed.
export async function markCashIncome(db: Pick<ScopedDb, "transactions">): Promise<number> {
  const { rows, months } = await loadDeposits(db);
  const found = saidNotIncome(rows) ? null : regularCashDeposits(rows, months);
  const income = new Set(found?.ids ?? []);
  const toIncome = rows.filter((r) => income.has(r.id) && r.categorySource !== "cash_income");
  const toDeposit = rows.filter((r) => !income.has(r.id) && r.categorySource === "cash_income");
  const [a, b] = await Promise.all([
    toIncome.length
      ? db.transactions.updateMany({
          where: { id: { in: toIncome.map((r) => r.id) } },
          data: { ...INCOME, categorySource: "cash_income" },
        })
      : { count: 0 },
    toDeposit.length
      ? db.transactions.updateMany({
          where: { id: { in: toDeposit.map((r) => r.id) } },
          data: { ...DEPOSIT, categorySource: "rule" },
        })
      : { count: 0 },
  ]);
  return a.count + b.count;
}

export type CashIncomeStatus =
  { counted: true; percent: number; count: number } | { counted: false; count: number };

// What the insights page says: the deposits counted as income and how sure, or, after the
// person's "not income", that they aren't (with a way back). Null when there's nothing to say.
export async function cashIncomeStatus(
  db: Pick<ScopedDb, "transactions">,
): Promise<CashIncomeStatus | null> {
  const { rows, months } = await loadDeposits(db);
  const counted = rows.filter((r) => r.categorySource === "cash_income");
  if (counted.length > 0) {
    const found = regularCashDeposits(counted, months);
    return { counted: true, percent: found?.percent ?? 0, count: counted.length };
  }
  if (!saidNotIncome(rows)) return null;
  const found = regularCashDeposits(rows, months);
  return found ? { counted: false, count: found.ids.length } : null;
}

// "Not income": every deposit counted as income goes back to a deposit, as the person's choice.
export async function declineCashIncome(db: Pick<ScopedDb, "transactions">): Promise<number> {
  const { count } = await db.transactions.updateMany({
    where: { categorySource: "cash_income" },
    data: { ...DEPOSIT, categorySource: "user" },
  });
  return count;
}

// The way back: the person's "not income" is forgotten and the deposits are sorted again.
export async function countCashIncome(db: Pick<ScopedDb, "transactions">): Promise<number> {
  await db.transactions.updateMany({
    where: {
      categorySource: "user",
      amountCents: { lt: 0 },
      pfcDetailed: { in: [...CASH_INCOME_CATEGORIES] },
    },
    data: { categorySource: "rule" },
  });
  return markCashIncome(db);
}
