import {
  CHARGES_PER_YEAR,
  PRICE_INCREASE_EXCLUDED_CATEGORIES,
  PRICE_INCREASE_EXCLUDED_PRIMARIES,
  PRICE_INCREASE_HIGH_CONFIDENCE_PRIOR_CHARGES,
  PRICE_INCREASE_MAX_PRIOR_SPREAD,
  PRICE_INCREASE_MIN_PRIOR_CHARGES,
  PRICE_INCREASE_THRESHOLD,
} from "@/config/detection";
import { formatCents } from "@/lib/money";
import { inList, lowest } from "../helpers";
import type { Stream } from "../streams";
import type { Candidate } from "../types";
import { streamEvidence, type Rule } from "./rule";

// Every charge before the latest is close to their average, i.e. the old price was fixed.
function steadyBefore(stream: Stream, average: number): boolean {
  return stream.charges
    .slice(0, -1)
    .every((c) => Math.abs(c.amountCents - average) <= average * PRICE_INCREASE_MAX_PRIOR_SPREAD);
}

// The latest charge is at least PRICE_INCREASE_THRESHOLD above the steady price before it.
// Savings are the increase per charge over a year.
export const priceIncrease: Rule = (_input, streams) =>
  streams.flatMap((stream): Candidate[] => {
    const { frequency, priorAverageCents, priorCount, lastAmountCents } = stream;
    if (
      !stream.active ||
      !frequency ||
      priorAverageCents === null ||
      priorAverageCents <= 0 ||
      priorCount < PRICE_INCREASE_MIN_PRIOR_CHARGES ||
      inList(stream.pfcPrimary, PRICE_INCREASE_EXCLUDED_PRIMARIES) ||
      inList(stream.pfcDetailed, PRICE_INCREASE_EXCLUDED_CATEGORIES) ||
      lastAmountCents < priorAverageCents * (1 + PRICE_INCREASE_THRESHOLD) ||
      !steadyBefore(stream, priorAverageCents)
    ) {
      return [];
    }

    const annual = (lastAmountCents - priorAverageCents) * CHARGES_PER_YEAR[frequency];
    const fromHistory =
      priorCount >= PRICE_INCREASE_HIGH_CONFIDENCE_PRIOR_CHARGES ? "high" : "medium";
    return [
      {
        type: "price_increase",
        key: stream.key,
        title: `${stream.merchant} went up from ${formatCents(priorAverageCents)} to ${formatCents(lastAmountCents)}`,
        annualSavingsCents: annual,
        amountCents: annual,
        confidence: lowest(fromHistory, stream.confidence),
        evidence: { ...streamEvidence(stream), priorAverageCents },
      },
    ];
  });
