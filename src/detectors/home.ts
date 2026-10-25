import { DETECTOR_RATES as R } from "@/config/detectors";
import { RISK_ANNUAL_PROBABILITY as CHANCE } from "@/config/suggestions";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, weakest, headlineOf } from "./helpers";

// Detectors for the home and the people in it (spec step 254): PMI, a costly mortgage and
// life cover. Pure; see ./contract.ts.

const mortgageBalance = (accounts: readonly { subtype: string | null; balanceCents: number }[]) =>
  accounts.filter((a) => a.subtype === "mortgage").reduce((s, a) => s + a.balanceCents, 0);

const pmiRemoval: Detector = {
  covers: ["mortgage", "home_equity"],
  capability: "debt",
  topic: "pmi_removal",
  needs: ["has_pmi"],
  detect({ profile, data }) {
    const pmi = profile.facts.has_pmi;
    const balance = mortgageBalance(data.accounts);
    if (pmi.value !== true || balance <= 0) return null;
    return {
      id: suggestionId("debt", "pmi_removal"),
      capability: "debt",
      topic: "pmi_removal",
      title: "Ask your lender to drop mortgage insurance",
      headline: headlineOf(
        "Drop your mortgage insurance",
        Math.round((balance * R.pmiBps) / 10_000),
        "saves",
      ),
      short: `Your mortgage of ${formatCents(balance)} carries PMI.`,
      worthCents: Math.round((balance * R.pmiBps) / 10_000),
      worthKind: "saves",
      confidence: factEvidence(pmi),
      urgency: "soon",
      why: `Your mortgage of ${formatCents(balance)} carries PMI, which usually costs about ${R.pmiBps / 100}% of the loan a year. Once you own enough of the home, it can come off.`,
      action: { label: "See if PMI can go", href: "/loans/equity" },
    };
  },
};

const refinance: Detector = {
  covers: ["refinance_offers"],
  capability: "debt",
  topic: "refinance",
  needs: ["mortgage_rate_bps"],
  detect({ profile, data }) {
    const rate = profile.facts.mortgage_rate_bps;
    const balance = mortgageBalance(data.accounts);
    if (typeof rate.value !== "number" || balance <= 0) return null;
    const gap = rate.value - R.marketMortgageBps;
    if (gap < R.refinanceMinGapBps) return null;
    return {
      id: suggestionId("debt", "refinance"),
      capability: "debt",
      topic: "refinance",
      title: "See what a cheaper mortgage would save",
      headline: headlineOf(
        "Check for a cheaper mortgage",
        Math.round((balance * gap) / 10_000),
        "saves",
      ),
      short: `Your rate is ${(rate.value / 100).toFixed(2)}% on ${formatCents(balance)}.`,
      worthCents: Math.round((balance * gap) / 10_000),
      worthKind: "saves",
      confidence: factEvidence(rate),
      urgency: "soon",
      why: `Your rate is ${(rate.value / 100).toFixed(2)}% on ${formatCents(balance)}; rates today are about ${(R.marketMortgageBps / 100).toFixed(2)}%, before closing costs.`,
      action: { label: "Check refinance offers", href: "/loans/refinance" },
    };
  },
};

const lifeInsurance: Detector = {
  covers: ["insurance_life"],
  capability: "insurance",
  topic: "life_insurance",
  needs: ["has_children", "insurance_life", "monthly_income"],
  detect({ profile }) {
    const kids = profile.facts.has_children;
    const life = profile.facts.insurance_life;
    const income = profile.facts.monthly_income;
    if (kids.value !== true || life.value !== false || typeof income.value !== "number")
      return null;
    return {
      id: suggestionId("insurance", "life_insurance"),
      capability: "insurance",
      topic: "life_insurance",
      title: "Look at life insurance for the people who depend on you",
      headline: headlineOf(
        "Get life cover for your family",
        income.value * 12 * R.lifeCoverYears,
        "risk",
      ),
      short: `You have children and I see no life-cover charge in ${profile.months} months.`,
      worthCents: income.value * 12 * R.lifeCoverYears,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(kids),
        evidence("seen", profile.months, 0, "life-cover charges"),
        factEvidence(income),
      ]),
      urgency: "soon",
      why: `You have children and I see no life-cover charge in ${profile.months} months. A common rule is ${R.lifeCoverYears} years of income, about ${formatCents(income.value * 12 * R.lifeCoverYears)} for you. The chance of needing it in a given year is small (about ${(CHANCE.life_insurance * 100).toFixed(1)}%), but the loss would be total.`,
      action: { label: "Check your cover", href: "/insurance/checkup" },
    };
  },
};

export const HOME_DETECTORS: readonly Detector[] = [pmiRemoval, refinance, lifeInsurance];
