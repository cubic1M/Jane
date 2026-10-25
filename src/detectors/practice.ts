import {
  OWN_INVESTING_SUBTYPES,
  PRACTICE_SUGGEST_FALL_SHARE,
  PRACTICE_SUGGEST_STAGES,
  PRACTICE_TOPIC,
} from "@/config/practice-cards";
import { PRACTICE_START_CENTS } from "@/config/portfolios";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { dollars, evidence, factEvidence, liquidCents, weakest } from "./helpers";

// "Start a practice portfolio" (spec step 296, Phase AW, Stage A): practice money on the sample
// market for someone still building up, not in debt trouble, with no taxable investment account
// of their own yet and no practice portfolio. Pure; see ./contract.ts. It is demo advice: it
// reaches the person through adviceMode and the guardrails like any other.

const practicePortfolio: Detector = {
  capability: "investing",
  topic: PRACTICE_TOPIC,
  // Its tool: the practice portfolio Claude reads (step 297).
  covers: ["practice_portfolio"],
  needs: ["life_stage"],
  detect({ profile, data }) {
    const stage = profile.facts.life_stage;
    const trouble = profile.facts.debt_trouble;
    if (typeof stage.value !== "string" || !PRACTICE_SUGGEST_STAGES.includes(stage.value)) {
      return null;
    }
    if (trouble.value === true || data.extras?.hasPracticePortfolio) return null;
    if (data.accounts.some((a) => OWN_INVESTING_SUBTYPES.includes(a.subtype ?? ""))) return null;
    const cash = liquidCents(data);
    // The fall met on practice money: a loss that costs nothing real.
    const fall = Math.round(PRACTICE_START_CENTS * PRACTICE_SUGGEST_FALL_SHARE);
    const share = `${Math.round(PRACTICE_SUGGEST_FALL_SHARE * 100)}%`;
    return {
      id: suggestionId("investing", PRACTICE_TOPIC),
      capability: "investing",
      topic: PRACTICE_TOPIC,
      title: "Start a practice portfolio before putting real money in",
      // The worth is a fall met on practice money; the headline says so rather than promising to
      // "avoid" a loss of real money.
      headline: `Try practice money: a ${dollars(fall)} dip costs nothing`,
      short: `You keep ${formatCents(cash)} in cash and no brokerage account yet.`,
      worthCents: fall,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(stage),
        factEvidence(trouble),
        evidence("seen", profile.months, data.accounts.length, "accounts"),
      ]),
      urgency: "later",
      why: `You keep ${formatCents(cash)} in checking and savings and have no brokerage account yet. A practice portfolio runs the model for your risk level on ${formatCents(PRACTICE_START_CENTS)} of practice money and sample prices: a ${share} fall there is ${formatCents(fall)} you can sit through without losing anything real.`,
      action: { label: "Start with practice money", href: "/investments/practice" },
    };
  },
};

export const PRACTICE_DETECTORS: readonly Detector[] = [practicePortfolio];
