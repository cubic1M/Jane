import { FIT_COMFORT_SHARE } from "@/config/fit";
import { formatCents } from "@/lib/money";

// "Can I afford a house?" and "what could I borrow?" measure a home loan two ways (loans QA):
// the usual 28/36 rules on gross pay (src/planning/home-buying.ts), and a mortgage payment kept
// to a comfortable share of take-home inside lenders' limits (the fit engine,
// src/planning/borrowing-power.ts). They give different sizes, so wherever one is shown the
// other is shown with it, in this one sentence saying why. Pure.

export type HomeMeasure = { maxPriceCents: number; downShare: number };

// Null when either is missing, or they're within this share of each other (nothing to explain).
const SAME_WITHIN = 0.02;

export function homeVsBorrow(
  home: HomeMeasure | null,
  mortgageCents: number | null,
): string | null {
  if (!home || !mortgageCents || home.maxPriceCents <= 0) return null;
  const loanCents = Math.round(home.maxPriceCents * (1 - home.downShare));
  if (Math.abs(loanCents - mortgageCents) <= loanCents * SAME_WITHIN) return null;
  return `Two measures, two sizes: the usual 28/36 rules on your gross pay put a home at about ${formatCents(home.maxPriceCents)} (a ${formatCents(loanCents)} loan with ${Math.round(home.downShare * 100)}% down, taxes and insurance counted), while keeping the mortgage payment to a comfortable ${Math.round(FIT_COMFORT_SHARE.mortgage * 100)}% of your take-home, inside what lenders allow, borrows about ${formatCents(mortgageCents)}.`;
}

// The same, as a clause for an answer that already says the 28/36 home (the chat keeps answers
// to three sentences): "keeping the mortgage payment ... borrows about $X instead".
export function homeVsBorrowClause(
  home: HomeMeasure | null,
  mortgageCents: number | null,
): string | null {
  if (!homeVsBorrow(home, mortgageCents)) return null;
  return `keeping the mortgage payment to a comfortable ${Math.round(FIT_COMFORT_SHARE.mortgage * 100)}% of your take-home, rather than the 28/36 rules on your gross pay, borrows about ${formatCents(mortgageCents!)} instead`;
}

// The mortgage "what could I borrow?" shows, from its figures; null when there's none.
export function mortgageOf(
  figures: readonly { product: string; available: boolean; amountCents?: number }[],
): number | null {
  const m = figures.find((f) => f.product === "mortgage" && f.available);
  return m?.amountCents ?? null;
}

// The 28/36 measure from a home-affordability result; null when it couldn't be worked out.
export function homeMeasureOf(home: {
  affordability: { maxPriceCents: number } | null;
  downShare: number;
}): HomeMeasure | null {
  return home.affordability
    ? { maxPriceCents: home.affordability.maxPriceCents, downShare: home.downShare }
    : null;
}
