import {
  CARD_ISSUERS,
  CASH_INCOME_MAX_AMOUNT_CV,
  CASH_INCOME_MAX_GAP_CV,
  CASH_INCOME_MAX_MEDIAN_GAP_DAYS,
  CASH_INCOME_MIN_DEPOSITS,
  CASH_INCOME_MIN_SPAN_DAYS,
  REGULAR_PAYER_MIN_CENTS,
  REGULAR_PAYER_NOT_INCOME,
  REGULAR_PAYER_OWN_MONEY_DAYS,
  REGULAR_PAYER_OWN_MONEY_SHARE,
  REGULAR_PAYER_PERSON_WORD,
} from "@/config/detection";
import { DAY_MS, isoDay } from "@/lib/dates";
import type { ScopedDb } from "@/lib/db-scoped";

// Pay with no pay word in the line (debugger 11-02): "NORTHWIND LABS" matched no rule, and Claude
// is only asked what a typical purchase at a merchant is, so a person's pay wasn't income on any
// page, and the forecast ran short. Money in from one payer, at a steady cadence and a similar
// amount, is income. Stricter than cash deposits (./cash-income.ts), which need only one of the
// two: a named payer could be many things. Banks, card companies, brokers and payment apps are
// left out, since that money is likely the person's own, and so is money that just left another of
// their accounts, whatever it's called. Rows the rules or the person placed stay.

const INCOME = { pfcPrimary: "INCOME", pfcDetailed: "INCOME_OTHER" } as const;

export type PayerRow = {
  id: string;
  date: string;
  // Plaid's sign: money in is negative.
  amountCents: number;
  merchantName: string | null;
  accountId?: string;
};

// Money leaving an account (Plaid's sign: positive).
export type MoneyOutRow = { accountId: string; date: string; amountCents: number };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// How much the values vary, as a share of their average.
const spread = (xs: number[]) => {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return mean === 0 ? Infinity : Math.sqrt(variance) / mean;
};

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

function isRegularPay(rows: readonly PayerRow[]): boolean {
  if (rows.length < CASH_INCOME_MIN_DEPOSITS) return false;
  const amounts = rows.map((r) => -r.amountCents);
  if (median(amounts) < REGULAR_PAYER_MIN_CENTS) return false;
  const days = [...new Set(rows.map((r) => dayNumber(r.date)))].sort((a, b) => a - b);
  if (days.length < 2 || days.at(-1)! - days[0] < CASH_INCOME_MIN_SPAN_DAYS) return false;
  const gaps = days.slice(1).map((d, i) => d - days[i]);
  return (
    median(gaps) <= CASH_INCOME_MAX_MEDIAN_GAP_DAYS &&
    spread(gaps) <= CASH_INCOME_MAX_GAP_CV &&
    spread(amounts) <= CASH_INCOME_MAX_AMOUNT_CV
  );
}

const notIncome = (name: string) =>
  REGULAR_PAYER_NOT_INCOME.test(name) || CARD_ISSUERS.some(([pattern]) => pattern.test(name));

// The same amount left a different account at about the same time. Leaving the account it came
// into doesn't count: that's pay being spent.
function isOwnMoney(rows: readonly PayerRow[], moneyOut: readonly MoneyOutRow[]): boolean {
  const moved = rows.filter((r) =>
    moneyOut.some(
      (o) =>
        o.accountId !== r.accountId &&
        o.amountCents === -r.amountCents &&
        Math.abs(dayNumber(o.date) - dayNumber(r.date)) <= REGULAR_PAYER_OWN_MONEY_DAYS,
    ),
  );
  return moved.length >= rows.length * REGULAR_PAYER_OWN_MONEY_SHARE;
}

// The ids of the rows that are regular pay.
export function regularPayers(
  rows: readonly PayerRow[],
  moneyOut: readonly MoneyOutRow[] = [],
): string[] {
  const byPayer = new Map<string, PayerRow[]>();
  for (const row of rows) {
    if (row.amountCents >= 0 || !row.merchantName || notIncome(row.merchantName)) continue;
    const key = row.merchantName.toLowerCase();
    byPayer.set(key, [...(byPayer.get(key) ?? []), row]);
  }
  return [...byPayer.values()]
    .filter((payer) => isRegularPay(payer) && !isOwnMoney(payer, moneyOut))
    .flat()
    .map((r) => r.id);
}

// Runs with the cash deposits, after an import, a bank sync and each night, before detection.
// Returns how many rows changed. Once income they stay: only unplaced rows and Claude's guesses
// are looked at, and an income row is neither.
export async function markRegularPayers(db: Pick<ScopedDb, "transactions">): Promise<number> {
  const rows = await db.transactions.findMany({
    where: {
      pending: false,
      amountCents: { lt: 0 },
      OR: [
        { pfcDetailed: null },
        { categorySource: "llm", NOT: { pfcPrimary: "INCOME" } },
        // Regular money by Zelle from someone: a tenant's rent, not a move of their own (debugger
        // 11-02). The rules call all of it a transfer. Moves of their own are left out below.
        {
          categorySource: "rule",
          pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
          description: { contains: REGULAR_PAYER_PERSON_WORD, mode: "insensitive" },
        },
      ],
    },
    select: { id: true, accountId: true, date: true, amountCents: true, merchantName: true },
  });
  if (rows.length === 0) return 0;
  const moneyOut = await db.transactions.findMany({
    where: { pending: false, amountCents: { in: [...new Set(rows.map((r) => -r.amountCents))] } },
    select: { accountId: true, date: true, amountCents: true },
  });
  const ids = regularPayers(
    rows.map((r) => ({ ...r, date: isoDay(r.date) })),
    moneyOut.map((o) => ({ ...o, date: isoDay(o.date) })),
  );
  if (ids.length === 0) return 0;
  const { count } = await db.transactions.updateMany({
    where: { id: { in: ids } },
    data: { ...INCOME, categorySource: "rule" },
  });
  return count;
}
