// What a finished action is worth, by one rule everywhere (docs/feature-audit.md, cluster 9): a
// refund the company sent, else a lower price the company agreed to (a year of it), else the
// estimate on the card. "Confirmed" is kept for what the person's own transactions show
// (src/lib/savings-proof.ts): until then this is money back or agreed, and is said that way.
export function actionWorthCents(
  action: { refundCents: number | null; confirmedAnnualCents: number | null },
  estimateCents: number | null = null,
): number | null {
  return action.refundCents ?? action.confirmedAnnualCents ?? estimateCents;
}

// How Jane says a finished action's money before the transactions show it.
export const BACK_OR_AGREED = "back or agreed";

// The saved-to-date total (savedToDate: done and do-it-yourself changes, estimates included) is
// expected savings, not what the transactions confirmed (/saved): it's labelled so wherever it's
// shown, so the two totals never look like the same number.
export const SAVED_SO_FAR_LABEL = "Saved so far (expected)";
