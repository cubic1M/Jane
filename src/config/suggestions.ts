import type { SuggestionTopic } from "@/config/people";
import type { FindingType } from "@/generated/prisma/client";

// Ranking and reaching (spec step 255): how the nightly scan orders what the detectors found
// and how much of it reaches a person each day.

// Step 147's budget: no more than this many suggestions are put in front of a person a day;
// the rest wait and are ranked again tomorrow.
export const SUGGESTIONS_PER_DAY = 3;

// Score = what it's worth a year x how sure Jane is x how urgent x what the person's own
// answers say. Risk avoided counts for a fraction of a saving: a large exposure still
// outranks small savings, but a made-up headline figure cannot bury everything else.
export const URGENCY_WEIGHT = { now: 3, soon: 2, later: 1 } as const;
export const WORTH_WEIGHT = { saves: 1, earns: 1, risk: 0.02 } as const;

// A loss avoided is ranked by its expected value in a year: the loss times how likely it is in
// a year. These are rough annual chances, to be agreed with each sector (they only order
// suggestions; the loss shown to the person is the full amount). A topic not listed uses
// WORTH_WEIGHT.risk.
export const RISK_ANNUAL_PROBABILITY: Readonly<Record<string, number>> = {
  // A working-age parent dying or being disabled in a year is rare.
  life_insurance: 0.005,
  // A claim on a home or renters policy, or a business loss.
  home_insurance: 0.05,
  renters_insurance: 0.05,
  business_insurance: 0.03,
  // A large fall in one company's stock, or a stretch without pay.
  concentration: 0.1,
  emergency_fund: 0.15,
  income_smoothing: 0.5,
  estimated_taxes: 0.3,
  business_separation: 0.1,
  hardship_plan: 0.3,
};

// A required action (a legal requirement, no cover at all for a business) ranks this many
// times higher than its dollars alone.
export const REQUIRED_BOOST = 3;

// What a suggestion counts for in ranking, in cents a year.
export function rankValue(
  topic: string,
  kind: keyof typeof WORTH_WEIGHT,
  worthCents: number,
): number {
  return kind === "risk"
    ? worthCents * (RISK_ANNUAL_PROBABILITY[topic] ?? WORTH_WEIGHT.risk)
    : worthCents * WORTH_WEIGHT[kind];
}

// What the person has said to suggestions of the same topic before (step 207): each yes
// raises it, each no lowers it, within these bounds.
export const YES_BOOST = 0.25;
export const NO_PENALTY = 0.5;
export const HISTORY_MIN_FACTOR = 0.1;
export const HISTORY_MAX_FACTOR = 2;

// And what happened after they said yes: a kind whose finished actions never showed a saving
// ranks lower, one that did ranks higher (src/lib/worked.ts).
export const WORKED_DOWN_FACTOR = 0.5;
export const WORKED_UP_FACTOR = 1.25;
export const WORKED_MIN_DONE = 3;
export const FINDING_KIND_OF_TOPIC: Partial<Record<SuggestionTopic, FindingType>> = {
  subscriptions: "subscription_review",
  bank_fees: "bank_fees",
  card_interest: "card_interest",
  idle_cash: "idle_cash",
};

// Suggestions that touch the same money: the interest on a card is in "pay down the card" and
// in "make a payoff plan", fees in bank fees, late fees and the hardship plan. Only the best of
// those that share a group is kept, so the dollars are counted once.
export const MONEY_GROUPS: Readonly<Record<string, readonly string[]>> = {
  card_interest: ["interest"],
  debt_plan: ["interest"],
  hardship_plan: ["interest", "fees"],
  bank_fees: ["fees"],
  late_fees: ["fees"],
};

// A suggestion that was offered and not answered can be offered again after this many days.
export const RESELECT_AFTER_DAYS = 14;

// Topics that amount to a recommendation on investments, taxes, insurance or loans: only for
// people in demo advice mode (src/lib/advice-mode.ts), and labelled as such. Real accounts
// never get them.
export const ADVICE_TOPICS: readonly SuggestionTopic[] = [
  "concentration",
  "retirement_self_employed",
  "estimated_taxes",
  "business_separation",
  "life_insurance",
  "business_insurance",
  "pmi_removal",
  "refinance",
  "backdoor_roth",
  "hsa",
  "withholding_gap",
  "catch_up",
  "social_security_timing",
  "medicare",
  "long_term_care",
  "medigap",
  "rmd",
  "health_insurance",
  "education_529",
  "employer_match",
];
