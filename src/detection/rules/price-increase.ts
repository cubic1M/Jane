import {
  CHARGES_PER_YEAR,
  PRICE_INCREASE_EXCLUDED_CATEGORIES,
  PRICE_INCREASE_EXCLUDED_PRIMARIES,
  PRICE_INCREASE_HIGH_CONFIDENCE_PRIOR_CHARGES,
  PRICE_INCREASE_MAX_CHARGES_SINCE,
  PRICE_INCREASE_MAX_PRIOR_SPREAD,
  PRICE_INCREASE_MIN_PRIOR_CHARGES,
  PRICE_INCREASE_THRESHOLD,
} from "@/config/detection";
import { formatCents } from "@/lib/money";
import { inList, lowest } from "../helpers";
import type { Stream } from "../streams";
import type { Candidate } from "../types";
import { streamEvidence, type Rule } from "./rule";

const near = (cents: number, to: number) =>
  Math.abs(cents - to) <= to * PRICE_INCREASE_MAX_PRIOR_SPREAD;

// Where the price changed: the charges at the latest price (the last few, all near it) and the
// steady ones before them. Null when there's no clean step. Not just the latest charge against
// all before it, which loses the rise as soon as a second charge at the new price comes
// (messy-bank QA: Netflix $15.49, $15.49, $17.99, $17.99 was no longer a price increase).
function priceStep(stream: Stream): { priorAverageCents: number; priorCount: number } | null {
  const charges = stream.charges.map((c) => c.amountCents);
  if (charges.length === 0) return null;
  const latest = charges[charges.length - 1];
  let since = 1;
  while (since < charges.length && near(charges[charges.length - 1 - since], latest)) since += 1;
  if (since > PRICE_INCREASE_MAX_CHARGES_SINCE) return null;
  const prior = charges.slice(0, charges.length - since);
  if (prior.length === 0) return null;
  const average = Math.round(prior.reduce((s, c) => s + c, 0) / prior.length);
  return prior.every((c) => near(c, average))
    ? { priorAverageCents: average, priorCount: prior.length }
    : null;
}

// The latest price is at least PRICE_INCREASE_THRESHOLD above the steady price before it.
// Savings are the increase per charge over a year.
export const priceIncrease: Rule = (_input, streams) =>
  streams.flatMap((stream): Candidate[] => {
    const { frequency, lastAmountCents } = stream;
    // A Plaid stream we don't have the charges for: its own averages.
    const step =
      stream.charges.length > 0
        ? priceStep(stream)
        : stream.priorAverageCents === null
          ? null
          : { priorAverageCents: stream.priorAverageCents, priorCount: stream.priorCount };
    if (
      !stream.active ||
      !frequency ||
      !step ||
      step.priorAverageCents <= 0 ||
      step.priorCount < PRICE_INCREASE_MIN_PRIOR_CHARGES ||
      inList(stream.pfcPrimary, PRICE_INCREASE_EXCLUDED_PRIMARIES) ||
      inList(stream.pfcDetailed, PRICE_INCREASE_EXCLUDED_CATEGORIES) ||
      lastAmountCents < step.priorAverageCents * (1 + PRICE_INCREASE_THRESHOLD)
    ) {
      return [];
    }
    const { priorAverageCents, priorCount } = step;

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
