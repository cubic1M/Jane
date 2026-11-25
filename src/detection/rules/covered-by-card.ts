import { CONDITION_WORDS, type CardBenefit, type CardProduct } from "@/config/card-benefits";
import {
  COVERED_BY_CARD_MAX_CONFIDENCE,
  COVER_AMBIGUOUS_BRANDS,
  COVER_NON_PHONE_WORDS,
  COVER_PHONE_WORDS,
  COVER_PLANS,
  PHONE_BILL_CATEGORIES,
  PHONE_BILL_RECENT_DAYS,
  RENTAL_CATEGORIES,
  TRIP_CATEGORIES,
} from "@/config/detection";
import { benefitOf, productById } from "@/lib/insurance/card-benefits";
import { inList, lowest, merchantMatches } from "../helpers";
import type { Stream } from "../streams";
import type { Candidate, DetectionInput } from "../types";
import { daysBetween } from "../units";
import { streamEvidence, type Rule } from "./rule";

// Cover the person already has (spec step 152): a plan they pay for (phone protection,
// rental car cover, an extended warranty, trip cancellation cover) that one of their cards
// already gives them. Raised only when the card covers everything the plan does and the
// person meets the card's condition, seen in their own transactions: the phone bill, the
// rentals or the trips paid with that card, or the plan bought with it. Savings are the
// plan's cost a year; Yes cancels it through the usual flow.

// A brand that also sells renters or home cover ("assurant") is the phone plan only when a charge's
// own words say phone or device.
// The config words are fixed text with no pattern characters, so building a pattern from them is safe.
const hasWord = (words: readonly string[], text: string, end: string) =>
  words.some((w) => new RegExp(`\\b${w}${end}`, "i").test(text));
// Another kind of policy named in the charge rules it out before a phone word is looked for
// ("ASSURANT MOBILE HOME INSURANCE"); a phone word starts a word ("cell" is "cellular").
const saysPhone = (stream: Stream) => {
  // The stream as it is billed now: its latest charge, not any past one (CodeRabbit on #2263).
  const latest = stream.charges.reduce<(typeof stream.charges)[number] | null>(
    (a, c) => (a === null || c.date > a.date ? c : a),
    null,
  );
  return (
    latest !== null &&
    !hasWord(COVER_NON_PHONE_WORDS, latest.description, "\\b") &&
    hasWord(COVER_PHONE_WORDS, latest.description, "")
  );
};

function planOf(stream: Stream) {
  const plan = COVER_PLANS.find((p) => merchantMatches(stream.merchantKey, p.merchants));
  if (plan?.kind === "phone" && merchantMatches(stream.merchantKey, COVER_AMBIGUOUS_BRANDS))
    return saysPhone(stream) ? plan : null;
  return plan ?? null;
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
    case "phone_bill": {
      // Every phone bill is on the card: with another paid some other way, which line the plan
      // protects isn't known (nothing here ties a plan to a line).
      const bills = streams.filter((s) => s.active && inList(s.pfcDetailed, PHONE_BILL_CATEGORIES));
      // The streams may have merged an identical bill on another account into the card's (one plan
      // seen twice), so a recent phone-bill charge elsewhere blocks it too.
      const elsewhere = input.transactions.some(
        (t) =>
          t.amountCents > 0 &&
          t.accountId !== cardId &&
          inList(t.pfcDetailed, PHONE_BILL_CATEGORIES) &&
          daysBetween(t.date, input.asOf) <= PHONE_BILL_RECENT_DAYS,
      );
      return bills.length > 0 && bills.every((s) => s.accountId === cardId) && !elsewhere;
    }
    case "the_purchase":
      // Paying for the warranty with the card isn't buying the item with it, and nothing here ties a
      // warranty to its item's purchase, so this is never said until it can be.
      return false;
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
