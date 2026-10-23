import { MEDICARE, SOCIAL_SECURITY } from "@/config/retirement-taxes";
import { formatCents } from "@/lib/money";
import { readRetirementTaxes } from "@/planning/retirement-taxes-read";
import { type Detector, suggestionId } from "./contract";
import { factEvidence, headlineOf, weakest } from "./helpers";

// Detectors for the run-up to retirement (detector coverage, spec step 254): signing up for
// Medicare on time, and when to claim Social Security. Pure; see ./contract.ts. Both are demo
// advice (ADVICE_TOPICS): only in demo advice mode, labelled.

const toldAge = (value: unknown) => (typeof value === "number" ? value : null);
const ageConfidence = (age: number | null, what: string) =>
  age !== null
    ? { percent: 85, reason: "you told me your age" }
    : {
        percent: 55,
        reason: `I don't know your age; your savings and the mortgage nearly paid off say you're near ${what}`,
      };

// Medicare starts at 65; Part B taken late costs 10% more for every year late, for life, unless
// work cover from a big enough employer lets it wait. Near 65, still working, not on it yet.
const medicare: Detector = {
  capability: "insurance",
  topic: "medicare",
  covers: [],
  needs: ["life_stage", "household"],
  detect({ profile, data }) {
    const r = readRetirementTaxes(profile, data);
    const age = toldAge(profile.facts.age.value);
    if (!r.nearMedicare || (age !== null && age >= MEDICARE.startAge + 1)) return null;
    // Already on it (a Medigap or Medicare charge), or retired on a pension with Social Security.
    if (profile.facts.insurance_medigap.value === true) return null;
    if (profile.facts.income_pattern.value === "pension") return null;
    const year = Number(profile.today.slice(0, 4));
    const known = Object.keys(MEDICARE.partBMonthlyCents).map(Number);
    const premium =
      MEDICARE.partBMonthlyCents[year] ?? MEDICARE.partBMonthlyCents[Math.max(...known)];
    // A year late, for each of them on Medicare: 10% of the premium, every month, for life.
    const perYearLate = Math.round(premium * MEDICARE.latePenaltyPerYear * 12 * r.people);
    const couple = r.people === 2;
    return {
      id: suggestionId("insurance", "medicare"),
      capability: "insurance",
      topic: "medicare",
      title: `Plan your Medicare sign-up for ${MEDICARE.startAge}, so Part B never costs more for life`,
      headline: headlineOf("Plan your Medicare sign-up", perYearLate, "risk"),
      short: `Part B taken a year late costs ${couple ? "the two of you " : ""}about ${formatCents(perYearLate)} more a year, for life.`,
      worthCents: perYearLate,
      worthKind: "risk",
      confidence: weakest([factEvidence(profile.facts.life_stage), ageConfidence(age, "65")]),
      urgency: age !== null && age >= MEDICARE.soonFromAge ? "soon" : "later",
      why: `Medicare starts at ${MEDICARE.startAge}, with a ${MEDICARE.windowMonths}-month window to sign up around the birthday. Part B taken later costs ${Math.round(MEDICARE.latePenaltyPerYear * 100)}% more for every year late, for as long as you have it: on the ${formatCents(premium)} monthly premium, about ${formatCents(perYearLate)} a year${couple ? " for the two of you" : ""} for each year. You're still working: if your health plan comes from an employer with ${MEDICARE.employerSizeToWait} or more people, Part B can wait until that cover ends without the penalty.`,
      action: { label: "Plan for Medicare", href: "/taxes/retirement" },
    };
  },
};

// Social Security's monthly benefit from today's pay (the bend points), per person.
function estimatedBenefitCents(yearlyPayCents: number): number {
  const monthly = Math.min(yearlyPayCents, SOCIAL_SECURITY.taxableMaxCents) / 12;
  const [first, second] = SOCIAL_SECURITY.bendPointsCents;
  const [a, b, c] = SOCIAL_SECURITY.bendShares;
  return Math.round(
    a * Math.min(monthly, first) +
      b * Math.max(0, Math.min(monthly, second) - first) +
      c * Math.max(0, monthly - second),
  );
}

// When to claim Social Security: each year waited past full retirement age (67) adds 8% for
// life, to 70. Near retirement, still earning, not claiming yet.
const socialSecurityTiming: Detector = {
  capability: "investing",
  topic: "social_security_timing",
  covers: ["retirement_income"],
  needs: ["life_stage", "monthly_income"],
  detect({ profile, data }) {
    const r = readRetirementTaxes(profile, data);
    const age = toldAge(profile.facts.age.value);
    const near =
      age !== null
        ? age >= SOCIAL_SECURITY.fromAge
        : profile.facts.life_stage.value === "approaching";
    if (!near || r.ssDeposits > 0) return null;
    if (age !== null && age >= SOCIAL_SECURITY.latestAge) return null;
    const wages = r.otherIncomeCents - r.pensionCents - r.iraDrawCents;
    if (wages <= 0) return null;
    // Each earner's benefit from an even share of the pay (the record is theirs to check).
    const each = estimatedBenefitCents(wages / r.people);
    const atFull = each * 12 * r.people;
    const years = SOCIAL_SECURITY.latestAge - SOCIAL_SECURITY.fullAge;
    const gain = Math.round(atFull * SOCIAL_SECURITY.delayCreditPerYear * years);
    const couple = r.people === 2;
    return {
      id: suggestionId("investing", "social_security_timing"),
      capability: "investing",
      topic: "social_security_timing",
      title: `Weigh claiming Social Security at ${SOCIAL_SECURITY.latestAge} instead of ${SOCIAL_SECURITY.fullAge}: about ${formatCents(gain)} more a year, for life`,
      headline: headlineOf("Weigh when to claim Social Security", gain, "earns"),
      short: `From your pay, about ${formatCents(atFull)} a year at ${SOCIAL_SECURITY.fullAge}${couple ? " for the two of you" : ""}; waiting to ${SOCIAL_SECURITY.latestAge} adds ${Math.round(SOCIAL_SECURITY.delayCreditPerYear * years * 100)}%.`,
      worthCents: gain,
      worthKind: "earns",
      confidence: weakest([
        factEvidence(profile.facts.monthly_income),
        ageConfidence(age, "retirement"),
        {
          percent: 60,
          reason: "the benefit is estimated from your pay today, not your Social Security record",
        },
      ]),
      urgency: age !== null && age >= SOCIAL_SECURITY.soonFromAge ? "soon" : "later",
      why: `From your pay today, Social Security would be about ${formatCents(atFull)} a year${couple ? " for the two of you" : ""} at full retirement age (${SOCIAL_SECURITY.fullAge}). Each year you wait after that adds ${Math.round(SOCIAL_SECURITY.delayCreditPerYear * 100)}%, for life: at ${SOCIAL_SECURITY.latestAge}, about ${formatCents(gain)} more a year. Claiming early, at 62, takes about 30% off. It's an estimate: your Social Security statement (ssa.gov/myaccount) has your real record, and the right age depends on your health, your savings and when you stop working.`,
      action: { label: "See my retirement paycheck", href: "/investments/retirement-income" },
    };
  },
};

export const RETIREMENT_DETECTORS: readonly Detector[] = [medicare, socialSecurityTiming];
