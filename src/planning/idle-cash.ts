import {
  ASSUMED_CURRENT_RATE_BPS,
  IDLE_CASH_MIN_EXCESS_CENTS,
  LOOKBACK_MONTHS,
  IDLE_CASH_MONTHS_OF_SPENDING,
  IDLE_CASH_SUBTYPES,
  NON_SPENDING_CATEGORIES,
  NON_SPENDING_PRIMARIES,
  REFERENCE_HIGH_YIELD_RATE_BPS,
} from "@/config/detection";
import { monthsBefore } from "@/detection/units";

// Idle cash, the one definition: checking and savings above IDLE_CASH_MONTHS_OF_SPENDING months
// of spending (the Today card, the brief and Jane's answer all use this function). Not the
// investing review's "cash above your target mix", which is a different thing. Pure.

export type IdleAccount = {
  id: string;
  type: string;
  subtype: string | null;
  balanceCents: number | null;
};
export type IdleTx = { date: string; amountCents: number; accountId: string; pfc: string | null };
export type IdleCash = {
  accountIds: string[];
  balanceCents: number;
  monthlyCents: number;
  cushionCents: number;
  excessCents: number;
  // A year of what the excess could earn above what it earns now.
  earnsCents: number;
  shortestHistoryMonths: number;
};

const DAYS_PER_MONTH = 30.4375;
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function idleCashOf(input: {
  asOf: string;
  accounts: readonly IdleAccount[];
  transactions: readonly IdleTx[];
}): IdleCash | null {
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
  // Average monthly spending, per account over that account's own history, then added up.
  let monthly = 0;
  let shortest = Infinity;
  for (const accountId of [...new Set(spending.map((t) => t.accountId))].sort()) {
    const rows = spending.filter((t) => t.accountId === accountId);
    const earliest = rows.reduce((min, t) => (t.date < min ? t.date : min), input.asOf);
    const months = Math.max(1, days(earliest, input.asOf) / DAYS_PER_MONTH);
    monthly += rows.reduce((sum, t) => sum + t.amountCents, 0) / months;
    shortest = Math.min(shortest, months);
  }
  const monthlyCents = Math.round(monthly);
  if (accounts.length === 0 || monthlyCents <= 0) return null;
  const balanceCents = accounts.reduce((sum, a) => sum + (a.balanceCents ?? 0), 0);
  const cushionCents = monthlyCents * IDLE_CASH_MONTHS_OF_SPENDING;
  const excessCents = balanceCents - cushionCents;
  if (excessCents < IDLE_CASH_MIN_EXCESS_CENTS) return null;
  return {
    accountIds: accounts.map((a) => a.id),
    balanceCents,
    monthlyCents,
    cushionCents,
    excessCents,
    earnsCents: Math.round(
      (excessCents * (REFERENCE_HIGH_YIELD_RATE_BPS - ASSUMED_CURRENT_RATE_BPS)) / 10_000,
    ),
    shortestHistoryMonths: shortest,
  };
}
