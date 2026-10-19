import {
  PICK_MIN_RATING_SCORE,
  PICK_RATING_PENALTY_PER_POINT,
  RESHOP_MIN_SAVING_CENTS,
  RESHOP_RUNNERS_UP,
} from "@/config/insurance";
import { formatCents } from "@/lib/money";
import { kindWords } from "./gaps";
import type { Policy } from "./policies";
import type { StoredQuote } from "./quotes";

// Jane's pick from the quotes for a policy (spec step 104): the lowest price for the same
// cover, weighted by the carrier's rating, why in three lines, and the runners-up. Only
// quotes with the same cover and deductible (or more) count, from carriers rated at least
// PICK_MIN_RATING_SCORE, and only if the pick saves RESHOP_MIN_SAVING_CENTS a year. Pure.
// Picking is a recommendation: it's shown in demo advice mode only (spec step 98).

export type ShopPick = {
  pick: StoredQuote;
  runnersUp: StoredQuote[];
  // What the pick saves a year against what the policy costs now.
  savingCents: number;
  // Why, in three lines.
  why: [string, string, string];
};

// The price with the rating counted: higher for a lower-rated carrier.
export const weighted = (q: StoredQuote) =>
  q.annualPremiumCents * (1 + (100 - q.carrier.ratingScore) * PICK_RATING_PENALTY_PER_POINT);

export function pickQuote(
  policy: Pick<Policy, "carrier" | "kind">,
  currentAnnualCents: number | null,
  quotes: StoredQuote[],
  // Spec step 149: a health plan's cost in a year with the person's usual care.
  currentTotalCents: number | null = null,
): ShopPick | null {
  if (policy.kind === "health") return pickHealthPlan(currentTotalCents, quotes);
  if (currentAnnualCents === null) return null;
  const eligible = quotes
    .filter((q) => q.sameCover && q.carrier.ratingScore >= PICK_MIN_RATING_SCORE)
    .sort(
      (a, b) =>
        weighted(a) - weighted(b) ||
        a.annualPremiumCents - b.annualPremiumCents ||
        a.carrier.name.localeCompare(b.carrier.name),
    );
  const [pick, ...rest] = eligible;
  if (!pick) return null;
  const savingCents = currentAnnualCents - pick.annualPremiumCents;
  if (savingCents < RESHOP_MIN_SAVING_CENTS) return null;
  const cheaper = eligible.filter((q) => q.annualPremiumCents < pick.annualPremiumCents);
  return {
    pick,
    runnersUp: rest.slice(0, RESHOP_RUNNERS_UP),
    savingCents,
    why: [
      `Same cover and deductible as your ${policy.carrier} ${kindWords(policy.kind)}.`,
      `${formatCents(pick.annualPremiumCents)} a year, ${formatCents(savingCents)} less than you pay now.`,
      cheaper.length > 0
        ? `Rated ${pick.carrier.rating} for paying claims, better than the ${cheaper.length === 1 ? "one quote" : `${cheaper.length} quotes`} that cost a little less.`
        : `Rated ${pick.carrier.rating} for paying claims, and the lowest price of the ${eligible.length === 1 ? "quote" : `${eligible.length} quotes`} with the same cover.`,
    ],
  };
}

// Spec step 149: health plans compare on total yearly cost (premium plus expected out of
// pocket with the person's usual care), not on the premium alone, weighted by rating.
function pickHealthPlan(currentTotalCents: number | null, quotes: StoredQuote[]): ShopPick | null {
  if (currentTotalCents === null) return null;
  const total = (q: StoredQuote) =>
    q.expectedCostCents! * (1 + (100 - q.carrier.ratingScore) * PICK_RATING_PENALTY_PER_POINT);
  const eligible = quotes
    .filter((q) => q.expectedCostCents !== null && q.carrier.ratingScore >= PICK_MIN_RATING_SCORE)
    .sort((a, b) => total(a) - total(b) || a.annualPremiumCents - b.annualPremiumCents);
  const [pick, ...rest] = eligible;
  if (!pick) return null;
  const savingCents = currentTotalCents - pick.expectedCostCents!;
  if (savingCents < RESHOP_MIN_SAVING_CENTS) return null;
  const oop = pick.expectedCostCents! - pick.annualPremiumCents;
  return {
    pick,
    runnersUp: rest.slice(0, RESHOP_RUNNERS_UP),
    savingCents,
    why: [
      `${pick.plan ?? pick.carrier.name} would cost about ${formatCents(pick.expectedCostCents!)} a year with your usual care: ${formatCents(pick.annualPremiumCents)} in premiums and about ${formatCents(oop)} out of pocket.`,
      `That's ${formatCents(savingCents)} less than your plan, counting the same care.`,
      `Its deductible is ${formatCents(pick.deductibleCents ?? 0)}, the most you'd pay in a year is ${formatCents(Number(pick.coverage.outOfPocketMax ?? 0))}, and it's rated ${pick.carrier.rating} for paying claims.`,
    ],
  };
}
