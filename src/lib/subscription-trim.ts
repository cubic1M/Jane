import { DETECTOR_RATES as R } from "@/config/detectors";
import { formatCents } from "@/lib/money";

// The subscriptions card's figure (src/detectors/money.ts) and the sentence on /subscriptions
// that says where it comes from: one share of the yearly total, from src/config/detectors.ts.
export const subscriptionTrimCents = (yearlyCents: number): number =>
  Math.round(yearlyCents * R.subscriptionTrimShare);

export function subscriptionTrimSentence(yearlyCents: number): string {
  const percent = Math.round(R.subscriptionTrimShare * 100);
  return `Could save about ${formatCents(subscriptionTrimCents(yearlyCents))} a year: ${percent}% of the ${formatCents(yearlyCents)} above, a rough estimate of what a look through the list can free up.`;
}
