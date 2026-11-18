import { QUESTIONS, UNLOCK, type QuestionSpec } from "@/config/questions";
import { DETECTORS, runDetectors } from "@/detectors";
import { buildProfile, type Profile, type ProfileInput, type ProfileTx } from "./build";
import type { FactKey } from "./facts";

// The one question worth asking (spec step 257). Pure. For each fact the profile doesn't
// have, how much would knowing it unlock; the best one not asked before is the question.

export type Candidate = {
  spec: QuestionSpec;
  unlockCents: number;
  // For a question that says what it decides (spec.decides): how many suggestions an answer changes.
  decidesCount?: number;
};

// What an answer could decide, worked out rather than assumed (suggest-taxes, 11-18): the
// detectors that need the fact are run as if the person gave each answer in turn. The answer that
// changes the most (a suggestion appears, goes, or changes its dollars) is what the question is
// worth: those suggestions' dollars, and how many they are. "unsure" decides nothing.
export function decidedBy(
  fact: FactKey,
  spec: QuestionSpec,
  data: ProfileInput,
): { cents: number; count: number } {
  const detectors = DETECTORS.filter((d) => d.needs.includes(fact));
  if (detectors.length === 0) return { cents: 0, count: 0 };
  const worth = (told: ProfileInput["told"]) => {
    const input = { ...data, told };
    const fired = runDetectors({ profile: buildProfile(input), data: input }, detectors);
    return new Map(fired.map((s) => [s.id, s.worthCents]));
  };
  const before = worth(data.told);
  let best = { cents: 0, count: 0 };
  for (const choice of spec.choices) {
    if (choice.value === "unsure") continue;
    const after = worth({ ...data.told, [fact]: choice.value });
    let cents = 0;
    let count = 0;
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(id) ?? 0;
      const b = after.get(id) ?? 0;
      if (a === b && before.has(id) === after.has(id)) continue;
      cents += Math.max(a, b);
      count += 1;
    }
    if (cents > best.cents) best = { cents, count };
  }
  return best;
}

const annualIncome = (p: Profile) =>
  typeof p.facts.monthly_income.value === "number" ? p.facts.monthly_income.value * 12 : 0;
const interest = (data: ProfileInput) =>
  data.transactions
    .filter((t: ProfileTx) => t.amountCents > 0 && (t.pfc ?? "").startsWith("BANK_FEES_"))
    .reduce((s, t) => s + t.amountCents, 0);

// What an answer could unlock for this person, or 0 when the question doesn't apply.
function unlockOf(fact: FactKey, profile: Profile, data: ProfileInput): number {
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
    case "is_student":
      // Asked only where the data leaves it open (./build.ts: paid by a university, no campus
      // spending), which is the only time it's unknown.
      return UNLOCK.studentCents;
    default:
      return 0;
  }
}

// Every question that applies, with what it would unlock, the most valuable first. A fact
// the profile already has (seen, told or answered) is not asked.
export function missingFacts(profile: Profile, data: ProfileInput): Candidate[] {
  return QUESTIONS.flatMap((spec): Candidate[] => {
    if (profile.facts[spec.fact].value !== null) return [];
    if (spec.decides) {
      const { cents, count } = decidedBy(spec.fact, spec, data);
      return cents > 0 ? [{ spec, unlockCents: cents, decidesCount: count }] : [];
    }
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
