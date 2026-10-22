import { QUESTIONS, UNLOCK, type QuestionSpec } from "@/config/questions";
import type { Profile, ProfileInput, ProfileTx } from "./build";
import type { FactKey } from "./facts";

// The one question worth asking (spec step 257). Pure. For each fact the profile doesn't
// have, how much would knowing it unlock; the best one not asked before is the question.

export type Candidate = { spec: QuestionSpec; unlockCents: number };

const annualIncome = (p: Profile) =>
  typeof p.facts.monthly_income.value === "number" ? p.facts.monthly_income.value * 12 : 0;
const interest = (data: ProfileInput) =>
  data.transactions
    .filter((t: ProfileTx) => t.amountCents > 0 && (t.pfc ?? "").startsWith("BANK_FEES_"))
    .reduce((s, t) => s + t.amountCents, 0);

// What an answer could unlock for this person, or 0 when the question doesn't apply.
export function unlockOf(fact: FactKey, profile: Profile, data: ProfileInput): number {
  const f = profile.facts;
  switch (fact) {
    case "employer_match":
      return f.has_401k.value === true && f.income_pattern.value === "salary"
        ? Math.round(annualIncome(profile) * UNLOCK.matchShareOfPay)
        : 0;
    case "age_band":
      // Only where age changes what's worth doing: near or in retirement.
      if (f.age.value !== null) return 0;
      return f.life_stage.value === "approaching"
        ? UNLOCK.ageApproachingCents
        : f.life_stage.value === "retired"
          ? UNLOCK.ageRetiredCents
          : 0;
    case "filing_status":
      return f.income_pattern.value === "uneven" ||
        f.income_pattern.value === "business" ||
        f.has_stock_plan.value === true
        ? Math.round(annualIncome(profile) * UNLOCK.filingShareOfIncome)
        : 0;
    case "business_structure":
      return f.income_pattern.value === "business"
        ? Math.round(annualIncome(profile) * UNLOCK.structureShareOfIncome)
        : 0;
    case "hardship_reason":
      return f.debt_trouble.value === true
        ? Math.round(interest(data) * UNLOCK.hardshipShareOfCosts)
        : 0;
    default:
      return 0;
  }
}

// Every question that applies, with what it would unlock, the most valuable first. A fact
// the profile already has (seen, told or answered) is not asked.
export function missingFacts(profile: Profile, data: ProfileInput): Candidate[] {
  return QUESTIONS.flatMap((spec) => {
    if (profile.facts[spec.fact].value !== null) return [];
    const unlockCents = unlockOf(spec.fact, profile, data);
    return unlockCents > 0 ? [{ spec, unlockCents }] : [];
  }).sort((a, b) => b.unlockCents - a.unlockCents || a.spec.fact.localeCompare(b.spec.fact));
}

// The question to ask now: the best one never asked before.
export function bestQuestion(
  profile: Profile,
  data: ProfileInput,
  asked: ReadonlySet<string>,
): Candidate | null {
  return missingFacts(profile, data).find((c) => !asked.has(c.spec.fact)) ?? null;
}
