import {
  CHARITY_CATEGORIES,
  ESTIMATED_TAX_DATES,
  INTEREST_LOAN_KINDS,
  PREPARER_GROUPS,
  SELF_EMPLOYED_INCOME_CATEGORIES,
  TAX_PACK_LAST_YEAR_UNTIL,
  TAX_PACK_YEARS_BACK,
  type PreparerGroup,
} from "@/config/tax-pack";
import { TAX_PACK_COPY } from "@/planning/tax-pack-copy";

// The tax-time pack (spec step 72): a year's charity gifts, spending people often show their
// tax preparer and contracting or gig income, grouped and totalled. Organizing only: it
// never decides what counts. Pure; dates are YYYY-MM-DD and amounts follow Plaid (positive is
// money out).

export type PackTransaction = {
  id: string;
  date: string;
  amountCents: number;
  description: string;
  merchantName: string | null;
  pfcDetailed: string | null;
};

export type PackLoan = {
  name: string;
  kind: string;
  ytdInterestPaidCents: number | null;
};

export type PackRow = { id: string; date: string; payee: string; amountCents: number };
export type PackGroup = { rows: PackRow[]; totalCents: number };

export type TaxPack = {
  year: number;
  charity: PackGroup;
  preparer: Record<PreparerGroup, PackGroup>;
  // Null for a past year: the bank only reports this year's interest.
  interest: { name: string; kind: string; cents: number }[] | null;
  income: PackGroup & { quarterCents: [number, number, number, number] };
  reminders: string[];
};

const yearOf = (day: string) => Number(day.slice(0, 4));

// Last year until the end of April (when people are gathering papers), then this year.
export function defaultTaxYear(today: string): number {
  const year = yearOf(today);
  return today.slice(5) <= TAX_PACK_LAST_YEAR_UNTIL ? year - 1 : year;
}

// The ?year= the person picked, when it's a year the pack can show; otherwise the default.
export function taxYearFrom(param: string | undefined, today: string): number {
  const current = yearOf(today);
  if (param && /^\d{4}$/.test(param)) {
    const year = Number(param);
    if (year <= current && year >= current - TAX_PACK_YEARS_BACK) return year;
  }
  return defaultTaxYear(today);
}

export function selectableYears(today: string): number[] {
  const current = yearOf(today);
  return Array.from({ length: TAX_PACK_YEARS_BACK + 1 }, (_, i) => current - i);
}

const pad = (n: number) => String(n).padStart(2, "0");

// The usual estimated-payment dates for a tax year, in order.
export function estimatedTaxDates(year: number): string[] {
  return ESTIMATED_TAX_DATES.map(
    (d) => `${year + (d.nextYear ? 1 : 0)}-${pad(d.month)}-${pad(d.day)}`,
  ).sort();
}

// The first estimated-payment date on or after today.
export function nextEstimatedTaxDate(today: string): string {
  const year = yearOf(today);
  return [...estimatedTaxDates(year - 1), ...estimatedTaxDates(year)].find((d) => d >= today)!;
}

const payee = (t: PackTransaction) => t.merchantName ?? t.description;

function group(transactions: PackTransaction[], test: (t: PackTransaction) => boolean): PackGroup {
  const rows = transactions
    .filter(test)
    .map((t) => ({ id: t.id, date: t.date, payee: payee(t), amountCents: Math.abs(t.amountCents) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { rows, totalCents: rows.reduce((sum, r) => sum + r.amountCents, 0) };
}

const isIn = (list: readonly string[]) => (t: PackTransaction) =>
  t.pfcDetailed !== null && list.includes(t.pfcDetailed);

export function buildTaxPack({
  year,
  today,
  transactions,
  loans,
}: {
  year: number;
  today: string;
  transactions: PackTransaction[];
  loans: PackLoan[];
}): TaxPack {
  const inYear = transactions.filter((t) => yearOf(t.date) === year);
  const out = inYear.filter((t) => t.amountCents > 0);
  const incoming = inYear.filter((t) => t.amountCents < 0);

  const income = group(incoming, isIn(SELF_EMPLOYED_INCOME_CATEGORIES));
  const quarterCents: [number, number, number, number] = [0, 0, 0, 0];
  for (const row of income.rows)
    quarterCents[Math.floor((Number(row.date.slice(5, 7)) - 1) / 3)] += row.amountCents;

  const preparer = Object.fromEntries(
    (Object.keys(PREPARER_GROUPS) as PreparerGroup[]).map((g) => [
      g,
      group(out, isIn(PREPARER_GROUPS[g])),
    ]),
  ) as Record<PreparerGroup, PackGroup>;

  const interest =
    year === yearOf(today)
      ? loans
          .filter(
            (l) =>
              (INTEREST_LOAN_KINDS as readonly string[]).includes(l.kind) &&
              l.ytdInterestPaidCents !== null &&
              l.ytdInterestPaidCents > 0,
          )
          .map((l) => ({ name: l.name, kind: l.kind, cents: l.ytdInterestPaidCents! }))
      : null;

  return {
    year,
    charity: group(out, isIn(CHARITY_CATEGORIES)),
    preparer,
    interest,
    income: { ...income, quarterCents },
    reminders: estimatedTaxDates(year),
  };
}

// CSV: a cell starting with = + - or @ could run as a formula in a spreadsheet, so it gets a
// leading quote; anything with a comma, quote or line break is wrapped in quotes.
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

// One row per transaction: group, date, payee and amount in dollars.
export function taxPackCsv(pack: TaxPack): string {
  const groups: [string, PackGroup][] = [
    [TAX_PACK_COPY.charityHeading, pack.charity],
    ...(Object.keys(pack.preparer) as PreparerGroup[]).map((g): [string, PackGroup] => [
      TAX_PACK_COPY.groupLabels[g],
      pack.preparer[g],
    ]),
    [TAX_PACK_COPY.incomeHeading, pack.income],
  ];
  const lines = [
    ["Group", "Date", "Payee", "Amount"],
    ...groups.flatMap(([label, g]) =>
      g.rows.map((r) => [label, r.date, r.payee, dollars(r.amountCents)]),
    ),
  ];
  return `${lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
