import {
  LIFE_HEALTH_QUESTIONS,
  LIFE_STANDARD_FACTOR,
  LIFE_TOBACCO_FACTOR,
  type LifeQuestionKey,
} from "@/config/insurance";

// A life insurance application's health questions (spec step 153), asked one at a time,
// and the stand-in carrier's decision on them. A real carrier decides through the insurance
// partner; the stand-in follows the same shape: an instant offer at a rate class, or a
// referral for the carrier's own review (a medical exam and records). Pure.

export type LifeAnswers = Partial<Record<LifeQuestionKey, boolean>>;

export type LifeDecision =
  | {
      outcome: "offered";
      rateClass: "preferred" | "standard" | "tobacco";
      annualPremiumCents: number;
      premiumCents: number;
    }
  | { outcome: "referred"; reason: string };

// Pure: the next question to ask, or null once all are answered.
export function nextLifeQuestion(answers: LifeAnswers): LifeQuestionKey | null {
  return LIFE_HEALTH_QUESTIONS.find((q) => answers[q.key] === undefined)?.key ?? null;
}

// Answers that need the carrier's own review rather than an instant decision.
const REFERRED: readonly LifeQuestionKey[] = ["conditions", "hospital", "driving"];

// Pure: the stand-in carrier's decision, priced from the quote the person picked.
export function standInDecision(
  quote: { annualPremiumCents: number; premiumCents: number; perYear: number },
  answers: LifeAnswers,
): LifeDecision {
  if (REFERRED.some((key) => answers[key])) {
    return {
      outcome: "referred",
      reason:
        "The carrier reviews health history like this itself, usually with a short medical exam, before it offers a price.",
    };
  }
  const factor =
    (answers.medication ? LIFE_STANDARD_FACTOR : 1) * (answers.tobacco ? LIFE_TOBACCO_FACTOR : 1);
  // Rounded to whole dollars a payment, as carriers bill.
  const premiumCents = Math.round((quote.premiumCents * factor) / 100) * 100;
  return {
    outcome: "offered",
    rateClass: answers.tobacco ? "tobacco" : answers.medication ? "standard" : "preferred",
    premiumCents,
    annualPremiumCents: premiumCents * quote.perYear,
  };
}
