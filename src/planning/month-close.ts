import { netWorth, notCounting } from "@/insights/net-worth";
import { kindOf } from "@/insights/spending";
import {
  CLOSE_TOP_CATEGORIES,
  UNCERTAIN_CATEGORIES,
  UNCERTAIN_MAX,
  UNCERTAIN_MIN_CENTS,
} from "@/config/month-close";

// The monthly close (spec step 244). Pure: a month's transactions in, the charges Jane wasn't
// sure of and the month's figures out.

export type CloseTx = {
  id: string;
  date: string;
  amountCents: number;
  description: string;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  categorySource: string | null;
};

export type CloseFigures = {
  month: string;
  incomeCents: number;
  spendingCents: number;
  topCategories: { category: string; cents: number }[];
  netWorthCents: number | null;
  // What that net worth leaves out for want of a balance, said beside it; null when complete.
  netWorthNotCounting?: string | null;
  // Open problems from the books check (step 238) when it closed: their figures are marked.
  booksOpen: number;
  // From the monthly report (step 148): paid down, plan against actual (205), what worked (207).
  paidDownCents: number | null;
  plan: {
    planned: { saving: number; debt: number; investing: number };
    did: { saving: number; debt: number; investing: number } | null;
  } | null;
  worked: { confirmed: number; notShown: number } | null;
  // Charges Jane asked about and the person confirmed as they were.
  confirmed: number;
};

const inMonth = (t: CloseTx, month: string) => t.date.startsWith(month);

// Charges in a catch-all category (or none) the person hasn't set, biggest first.
export function uncertainOf(
  txns: readonly CloseTx[],
  month: string,
  max = UNCERTAIN_MAX,
): CloseTx[] {
  return txns
    .filter(
      (t) =>
        inMonth(t, month) &&
        t.amountCents >= UNCERTAIN_MIN_CENTS &&
        t.categorySource !== "user" &&
        (t.pfcDetailed === null || UNCERTAIN_CATEGORIES.includes(t.pfcDetailed)),
    )
    .sort((a, b) => b.amountCents - a.amountCents || a.id.localeCompare(b.id))
    .slice(0, max);
}

// What the month came to, from its transactions, counted as the Money page, Insights and the
// monthly report count a month (kindOf, src/insights/spending.ts): refunds net against spending,
// money moved between the person's own accounts is neither, and a month never goes below $0 (gate
// B: the close counted refunds as nothing and income-tagged outflows as spending, so its "went
// out" wasn't the monthly report's "spent" for the same month).
export function monthFigures(
  txns: readonly CloseTx[],
  month: string,
): Pick<CloseFigures, "month" | "incomeCents" | "spendingCents" | "topCategories"> {
  const these = txns.filter((t) => inMonth(t, month));
  const kinded = these.map((t) => ({ t, kind: kindOf({ ...t, pending: false }) }));
  const income = kinded.filter((k) => k.kind === "income").reduce((s, k) => s - k.t.amountCents, 0);
  const byCategory = new Map<string, number>();
  for (const { t } of kinded.filter((k) => k.kind === "spending")) {
    const c = t.pfcPrimary ?? "OTHER";
    byCategory.set(c, (byCategory.get(c) ?? 0) + t.amountCents);
  }
  return {
    month,
    incomeCents: income,
    spendingCents: Math.max(
      0,
      [...byCategory.values()].reduce((s, cents) => s + cents, 0),
    ),
    topCategories: [...byCategory.entries()]
      .filter(([, cents]) => cents > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, CLOSE_TOP_CATEGORIES)
      .map(([category, cents]) => ({ category, cents })),
  };
}

// "FOOD_AND_DRINK" as "Food and drink".
export const categoryWords = (primary: string) => {
  const w = primary.toLowerCase().replaceAll("_", " ");
  return w.charAt(0).toUpperCase() + w.slice(1);
};

// Net worth at the close: none when no balance is known (never a silent $0), and what it leaves
// out for want of a balance said beside it (the CSV bench's skipped-balance path). Pure.
// Each account's balance on the month's last day: its last snapshot on or before it, as the month-
// by-month net worth reads it (src/insights/net-worth.ts). An account with none by then keeps the
// balance it has. A close taken weeks later, as a first upload's is, said that day's balance as
// "Net worth at the close" (debug 2, 11-18: $642.18 for an Oct 31 that Ahead had at $915.16).
export function balancesAtMonthEnd<T extends { id: string; currentBalanceCents: number | null }>(
  accounts: readonly T[],
  snapshots: readonly { accountId: string; date: string; balanceCents: number }[],
  month: string,
): T[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const latest = new Map<string, { date: string; balanceCents: number }>();
  for (const s of snapshots) {
    if (s.date > last) continue;
    const known = latest.get(s.accountId);
    if (!known || s.date > known.date) latest.set(s.accountId, s);
  }
  return accounts.map((a) => {
    const s = latest.get(a.id);
    return s ? { ...a, currentBalanceCents: s.balanceCents } : a;
  });
}

// Accounts that can have existed by the month's last day. One whose own balance history starts
// after it, with no transaction on or before it and linked after it, is out of that month's net
// worth. An account with no history at all keeps the balance it has, as balancesAtMonthEnd says.
export function accountsOpenBy<T extends { id: string; createdAt: Date }>(
  accounts: readonly T[],
  snapshots: readonly { accountId: string; date: string }[],
  withTxnByEnd: ReadonlySet<string>,
  month: string,
): T[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const first = new Map<string, string>();
  for (const s of snapshots) {
    const known = first.get(s.accountId);
    if (!known || s.date < known) first.set(s.accountId, s.date);
  }
  return accounts.filter((a) => {
    const began = first.get(a.id);
    return (
      began === undefined ||
      began <= last ||
      withTxnByEnd.has(a.id) ||
      a.createdAt.toISOString().slice(0, 10) <= last
    );
  });
}

export function closeNetWorth(
  accounts: { id: string; name: string; type: string; currentBalanceCents: number | null }[],
  owned: { id: string; valueCents: number; valuedOn: string }[],
  crypto: number,
): Pick<CloseFigures, "netWorthCents" | "netWorthNotCounting"> {
  if (accounts.length === 0) return { netWorthCents: null, netWorthNotCounting: null };
  const worth = netWorth(
    accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balanceCents: a.currentBalanceCents,
    })),
    owned,
    crypto,
  );
  return {
    netWorthCents: worth.known ? worth.netCents : null,
    netWorthNotCounting: notCounting(worth.unbalanced)?.sentence ?? null,
  };
}
