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
): ShopPick | null {
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
