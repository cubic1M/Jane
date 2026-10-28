import { netWorth, notCounting } from "@/insights/net-worth";
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
export function uncertainOf(txns: readonly CloseTx[], month: string): CloseTx[] {
  return txns
    .filter(
      (t) =>
        inMonth(t, month) &&
        t.amountCents >= UNCERTAIN_MIN_CENTS &&
        t.categorySource !== "user" &&
        (t.pfcDetailed === null || UNCERTAIN_CATEGORIES.includes(t.pfcDetailed)),
    )
    .sort((a, b) => b.amountCents - a.amountCents || a.id.localeCompare(b.id))
    .slice(0, UNCERTAIN_MAX);
}

const isSpending = (t: CloseTx) =>
  t.amountCents > 0 &&
  !(t.pfcPrimary ?? "").startsWith("TRANSFER") &&
  t.pfcDetailed !== "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

// What the month came to, from its transactions.
export function monthFigures(
  txns: readonly CloseTx[],
  month: string,
): Pick<CloseFigures, "month" | "incomeCents" | "spendingCents" | "topCategories"> {
  const these = txns.filter((t) => inMonth(t, month));
  const income = these
    .filter((t) => t.amountCents < 0 && t.pfcPrimary === "INCOME")
    .reduce((s, t) => s - t.amountCents, 0);
  const spent = these.filter(isSpending);
  const byCategory = new Map<string, number>();
  for (const t of spent) {
    const c = t.pfcPrimary ?? "OTHER";
    byCategory.set(c, (byCategory.get(c) ?? 0) + t.amountCents);
  }
  return {
    month,
    incomeCents: income,
    spendingCents: spent.reduce((s, t) => s + t.amountCents, 0),
    topCategories: [...byCategory.entries()]
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
export function closeNetWorth(
  accounts: { id: string; name: string; type: string; currentBalanceCents: number | null }[],
  owned: { id: string; valueCents: number; valuedOn: Date }[],
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
    owned.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) })),
    crypto,
  );
  return {
    netWorthCents: worth.known ? worth.netCents : null,
    netWorthNotCounting: notCounting(worth.unbalanced)?.sentence ?? null,
  };
}
