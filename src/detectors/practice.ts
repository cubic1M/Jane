import {
  OWN_INVESTING_SUBTYPES,
  PRACTICE_SUGGEST_STAGES,
  PRACTICE_TOPIC,
} from "@/config/practice-cards";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, liquidCents, weakest } from "./helpers";

// "Start a practice portfolio" (spec step 296, Phase AW, Stage A): practice money on the sample
// market for someone still building up, not in debt trouble, with no taxable investment account
// of their own yet and no practice portfolio. Pure; see ./contract.ts. It is demo advice: it
// reaches the person through adviceMode and the guardrails like any other.

const practicePortfolio: Detector = {
  capability: "investing",
  topic: PRACTICE_TOPIC,
  covers: [],
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
    return {
      id: suggestionId("investing", PRACTICE_TOPIC),
      capability: "investing",
      topic: PRACTICE_TOPIC,
      title: "Start a practice portfolio before putting real money in",
      headline: "Start a practice portfolio, no real money",
      short: `You keep ${formatCents(cash)} in cash and no investment account of your own yet.`,
      worthCents: 0,
      worthKind: "earns",
      confidence: weakest([
        factEvidence(stage),
        factEvidence(trouble),
        evidence("seen", profile.months, data.accounts.length, "accounts"),
      ]),
      urgency: "later",
      why: `You keep ${formatCents(cash)} in checking and savings and have no investment account of your own yet. A practice portfolio runs the model for your risk level on practice money and sample prices, so you can see how it behaves before any real money goes in.`,
      action: { label: "Start with practice money", href: "/investments/practice" },
    };
  },
};

export const PRACTICE_DETECTORS: readonly Detector[] = [practicePortfolio];
