import type { Confidence } from "@/detectors/contract";
import { DAYS_PER_MONTH, daysBetween } from "@/detection/units";
import type { DetectionInput } from "@/detection/types";
import { confidenceOf, evidenceText } from "@/profile/confidence";

// How sure a heads-up from the transactions is (a bill that went up, a new fee, a trial about
// to end), the same way the suggestions say it (src/profile/confidence.ts): from how many
// months of statements there are and how many charges show it. `max` caps a guess, like a
// trial's end date.
export function seenConfidence(
  input: Pick<DetectionInput, "asOf" | "historyFrom" | "transactions">,
  matches: number,
  what: string,
  max = 100,
): Confidence {
  const first =
    input.historyFrom ??
    input.transactions.reduce((min, t) => (t.date < min ? t.date : min), input.asOf);
  const months = Math.max(0, Math.round(daysBetween(first, input.asOf) / DAYS_PER_MONTH));
  const evidence = { months, matches };
  return {
    percent: Math.min(max, confidenceOf("seen", evidence)),
    reason: evidenceText("seen", evidence, what),
  };
}
