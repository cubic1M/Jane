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
