import { CONDITION_WORDS, type CardBenefit, type CardProduct } from "@/config/card-benefits";
import {
  COVERED_BY_CARD_MAX_CONFIDENCE,
  COVER_PLANS,
  PHONE_BILL_CATEGORIES,
  RENTAL_CATEGORIES,
  TRIP_CATEGORIES,
} from "@/config/detection";
import { benefitOf, productById } from "@/lib/insurance/card-benefits";
import { inList, lowest, merchantMatches } from "../helpers";
import type { Stream } from "../streams";
import type { Candidate, DetectionInput } from "../types";
import { streamEvidence, type Rule } from "./rule";

// Cover the person already has (spec step 152): a plan they pay for (phone protection,
// rental car cover, an extended warranty, trip cancellation cover) that one of their cards
// already gives them. Raised only when the card covers everything the plan does and the
// person meets the card's condition, seen in their own transactions: the phone bill, the
// rentals or the trips paid with that card, or the plan bought with it. Savings are the
// plan's cost a year; Yes cancels it through the usual flow.

function planOf(stream: Stream) {
  return COVER_PLANS.find((plan) => merchantMatches(stream.merchantKey, plan.merchants)) ?? null;
}

// Whether the person meets the card's condition, from their transactions.
function conditionMet(
  benefit: CardBenefit,
  cardId: string,
  input: DetectionInput,
  plan: Stream,
  streams: Stream[],
): boolean {
  const paidWith = (categories: readonly string[]) => {
    const rows = input.transactions.filter(
      (t) => t.amountCents > 0 && inList(t.pfcDetailed, categories),
    );
    return rows.length > 0 && rows.every((t) => t.accountId === cardId);
  };
  switch (benefit.condition) {
    case "phone_bill":
      return streams.some(
        (s) => s.active && inList(s.pfcDetailed, PHONE_BILL_CATEGORIES) && s.accountId === cardId,
      );
    case "the_purchase":
      return plan.accountId === cardId;
    case "rentals":
      return paidWith(RENTAL_CATEGORIES);
    case "trips":
      return paidWith(TRIP_CATEGORIES);
  }
}

// The card that covers this plan, with its benefit, if any.
export function coveringCard(
  stream: Stream,
  input: DetectionInput,
  streams: Stream[],
): { product: CardProduct; benefit: CardBenefit } | null {
  const plan = planOf(stream);
  if (!plan || !stream.active) return null;
  for (const [cardId, productId] of Object.entries(input.cardProducts ?? {})) {
    const product = productById(productId);
    const benefit = product ? benefitOf(product, plan.kind) : null;
    if (!product || !benefit) continue;
    if (!plan.covers.every((peril) => benefit.covers.includes(peril))) continue;
    if (conditionMet(benefit, cardId, input, stream, streams)) return { product, benefit };
  }
  return null;
}

export const coveredByCard: Rule = (input, streams) =>
  streams.flatMap((stream): Candidate[] => {
    const covering = coveringCard(stream, input, streams);
    if (!covering) return [];
    const { product, benefit } = covering;
    return [
      {
        type: "covered_by_card",
        key: `card:${product.id}:${stream.key}`,
        title: `Your ${product.name} already covers what ${stream.merchant} does`,
        annualSavingsCents: stream.annualCostCents,
        amountCents: stream.annualCostCents ?? stream.lastAmountCents,
        confidence: lowest(COVERED_BY_CARD_MAX_CONFIDENCE, stream.confidence),
        evidence: {
          ...streamEvidence(stream),
          card: product.name,
          benefit: benefit.label,
          condition: CONDITION_WORDS[benefit.condition],
          limits: benefit.limits.map((l) => ({
            label: l.label,
            cents: l.cents,
            text: l.text ?? null,
          })),
          reviewedOn: product.reviewedOn,
        },
      },
    ];
  });
