import {
  ASSUMED_CURRENT_RATE_BPS,
  IDLE_CASH_MIN_EXCESS_CENTS,
  LOOKBACK_MONTHS,
  IDLE_CASH_MONTHS_OF_SPENDING,
  IDLE_CASH_SUBTYPES,
  IDLE_CASH_TAX_DATE_DAYS,
  NON_SPENDING_CATEGORIES,
  NON_SPENDING_PRIMARIES,
  REFERENCE_HIGH_YIELD_RATE_BPS,
} from "@/config/detection";
import { categoryOf } from "@/categorize/taxonomy";
import { ESTIMATED_TAX_DATES } from "@/config/tax-pack";
import { addDays, monthsBefore } from "@/detection/units";
import { oneOffCharges, withoutOneOffs } from "@/insights/typical-month";
import { daysBetween } from "@/lib/dates";

// Idle cash, the one definition: checking and savings above IDLE_CASH_MONTHS_OF_SPENDING months
// of spending (the Today card, the brief and Jane's answer all use this function). Not the
// investing review's "cash above your target mix", which is a different thing. Pure.

export type IdleAccount = {
  id: string;
  type: string;
  subtype: string | null;
  balanceCents: number | null;
};
export type IdleTx = {
  date: string;
  amountCents: number;
  accountId: string;
  pfc: string | null;
  // The bank's words: with them, one-off charges are found and left out.
  description?: string;
};
export type IdleCash = {
  accountIds: string[];
  balanceCents: number;
  monthlyCents: number;
  cushionCents: number;
  // Held back for dated payments still to come inside the cushion's months (estimated tax).
  setAsideCents: number;
  excessCents: number;
  // A year of what the excess could earn above what it earns now.
  earnsCents: number;
  shortestHistoryMonths: number;
};

const DAYS_PER_MONTH = 30.4375;

type IdleInput = {
  asOf: string;
  accounts: readonly IdleAccount[];
  transactions: readonly IdleTx[];
};

// The cushion figures whatever the excess, so a checkup can say how near the line cash is.
// Null with no checking or savings balance, or no spending to measure months by.
export function cashCushionOf(input: IdleInput): Omit<IdleCash, "earnsCents"> | null {
  const accounts = input.accounts
    .filter(
      (a) =>
        a.type === "depository" &&
        IDLE_CASH_SUBTYPES.includes((a.subtype ?? "").toLowerCase()) &&
        a.balanceCents !== null &&
        a.balanceCents > 0,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  // Spending in the lookback window only, the same twelve months wherever the data came from.
  const cutoff = monthsBefore(input.asOf, LOOKBACK_MONTHS);
  const spending = input.transactions.filter(
    (t) =>
      t.date > cutoff &&
      t.date <= input.asOf &&
      t.amountCents > 0 &&
      !NON_SPENDING_PRIMARIES.some((p) => (t.pfc ?? "").startsWith(p)) &&
      !NON_SPENDING_CATEGORIES.includes(t.pfc as never),
  );
  // One-off charges (a car, a sofa) aren't months of spending: left out as every other monthly
  // figure leaves them out (src/insights/typical-month.ts). Night QA 10-30: $11,200 of one-offs
  // made the checkup say "$15,860 cash, under 3 months of spending" for someone whose usual
  // month is about $2,700, while the cushion card, which leaves them out, saw enough cash.
  // Estimated tax payments are dated, not monthly spending: held back below for each date still
  // to come, and left out of the months of spending so they aren't counted twice.
  const estimated = input.transactions.filter(
    (t) => t.date > cutoff && t.date <= input.asOf && isEstimatedTax(t),
  );
  const usual = withoutOneOffsOf(
    spending.filter((t) => !isEstimatedTax(t)),
    input.asOf,
  );
  // Average monthly spending, per account over that account's own history, then added up.
  let monthly = 0;
  let shortest = Infinity;
  for (const accountId of [...new Set(usual.map((t) => t.accountId))].sort()) {
    const rows = usual.filter((t) => t.accountId === accountId);
    const earliest = rows.reduce((min, t) => (t.date < min ? t.date : min), input.asOf);
    const months = Math.max(1, daysBetween(earliest, input.asOf) / DAYS_PER_MONTH);
    monthly += rows.reduce((sum, t) => sum + t.amountCents, 0) / months;
    shortest = Math.min(shortest, months);
  }
  const monthlyCents = Math.round(monthly);
  if (accounts.length === 0 || monthlyCents <= 0) return null;
  const balanceCents = accounts.reduce((sum, a) => sum + (a.balanceCents ?? 0), 0);
  const cushionCents = monthlyCents * IDLE_CASH_MONTHS_OF_SPENDING;
  const last = [...estimated].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const until = addDays(input.asOf, Math.round(IDLE_CASH_MONTHS_OF_SPENDING * DAYS_PER_MONTH));
  const setAsideCents = last
    ? last.amountCents * estimatedDatesBetween(input.asOf, until).length
    : 0;
  return {
    accountIds: accounts.map((a) => a.id),
    balanceCents,
    monthlyCents,
    cushionCents,
    setAsideCents,
    excessCents: balanceCents - cushionCents - setAsideCents,
    shortestHistoryMonths: shortest,
  };
}

export function idleCashOf(input: IdleInput): IdleCash | null {
  const cushion = cashCushionOf(input);
  if (!cushion || cushion.excessCents < IDLE_CASH_MIN_EXCESS_CENTS) return null;
  return {
    ...cushion,
    earnsCents: Math.round(
      (cushion.excessCents * (REFERENCE_HIGH_YIELD_RATE_BPS - ASSUMED_CURRENT_RATE_BPS)) / 10_000,
    ),
  };
}

function withoutOneOffsOf(spending: readonly IdleTx[], asOf: string): IdleTx[] {
  if (spending.some((t) => t.description === undefined)) return [...spending];
  const rows = spending.map((t) => ({
    ...t,
    description: t.description ?? "",
    merchantName: null,
    pfcPrimary: t.pfc ? (categoryOf(t.pfc)?.primary ?? null) : null,
    pfcDetailed: t.pfc,
    pending: false,
  }));
  return withoutOneOffs(rows, oneOffCharges(rows, asOf));
}

// The IRS estimated-payment dates after `from`, up to and including `until` (YYYY-MM-DD).
function estimatedDatesBetween(from: string, until: string): string[] {
  const first = Number(from.slice(0, 4)) - 1;
  const years = Array.from({ length: Number(until.slice(0, 4)) - first + 1 }, (_, i) => first + i);
  const dates = new Set<string>();
  for (const taxYear of years) {
    for (const d of ESTIMATED_TAX_DATES) {
      const year = d.nextYear ? taxYear + 1 : taxYear;
      dates.add(`${year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`);
    }
  }
  return [...dates].filter((d) => d > from && d <= until).sort();
}

// A tax payment near an estimated-payment date (IDLE_CASH_TAX_DATE_DAYS).
function isEstimatedTax(t: IdleTx): boolean {
  if (t.pfc !== "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" || t.amountCents <= 0) return false;
  const year = Number(t.date.slice(0, 4));
  return estimatedDatesBetween(`${year - 1}-12-31`, `${year + 1}-01-31`).some(
    (d) => Math.abs(daysBetween(d, t.date)) <= IDLE_CASH_TAX_DATE_DAYS,
  );
}
