import { formatCents } from "@/lib/money";

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

// The "Done" section's one line on /jane: the saved-to-date total is expected, as above, never
// "saved" before the transactions show it (debugger 11-01).
export function doneSummary(
  savedToDateCents: number,
  finished: number,
  confirmedCents = 0,
): string {
  if (confirmedCents > 0) return `${formatCents(confirmedCents)} confirmed`;
  if (savedToDateCents > 0) return `about ${formatCents(savedToDateCents)} a year expected`;
  return finished === 0 ? "nothing yet" : `${finished} finished`;
}

// The line over /jane's "Done": what the transactions confirm, as Home says it, and no "a year",
// since a refund is in it (debugger 11-02); what's only expected is said apart.
export function savedSoFarLine(savedToDateCents: number, confirmedCents: number): string | null {
  if (confirmedCents > 0) {
    const more = savedToDateCents - confirmedCents;
    const confirmed = `Saved so far: ${formatCents(confirmedCents)}, confirmed in your transactions`;
    return more > 0 ? `${confirmed}. About ${formatCents(more)} more expected.` : confirmed;
  }
  return savedToDateCents > 0
    ? `${SAVED_SO_FAR_LABEL}: about ${formatCents(savedToDateCents)} a year`
    : null;
}
