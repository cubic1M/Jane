import { DETECTOR_RATES as R } from "@/config/detectors";
import { SAVING_RATES } from "@/config/insurance";
import { computeNeeds, needInputFromProfile } from "@/lib/insurance/need";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, headlineOf, outCents } from "./helpers";
import { AUTO_HOME, CAPS, capped, combine, premiums } from "./insurance";

// Perfect coverage (spec step 277): a detector for each gap the need calculators find
// (src/lib/insurance/need), so the page, the chat and the nightly scan all work from the same
// numbers. Each opens the option card for its gap. Pure; see ./contract.ts.

const needsOf = (ctx: Parameters<Detector["detect"]>[0]) => {
  const input = needInputFromProfile(ctx.profile, ctx.data);
  return input ? { input, needs: computeNeeds(input) } : null;
};
const OPTIONS = (need: string) => ({
  label: "See my options",
  href: `/insurance?need=${need}#options`,
});

const disabilityGap: Detector = {
  capability: "insurance",
  covers: ["insurance_policies"],
  topic: "disability_insurance",
  needs: ["income_pattern", "monthly_income", "life_stage"],
  detect(ctx) {
    const { profile } = ctx;
    const found = needsOf(ctx);
    const pattern = profile.facts.income_pattern;
    if (!found || profile.facts.life_stage.value === "retired") return null;
    if (!["salary", "uneven", "business"].includes(String(pattern.value))) return null;
    const need = found.needs.find((n) => n.kind === "disability");
    if (!need || need.gapCents <= 0) return null;
    const yearly = need.gapCents * 12;
    const short = `You earn about ${formatCents(Math.round((found.input.yearlyPayCents ?? 0) / 12))} a month, with no disability cover on file.`;
    return {
      id: suggestionId("insurance", "disability_insurance"),
      capability: "insurance",
      topic: "disability_insurance",
      title: "Cover your pay if you can't work",
      headline: headlineOf("Add disability cover for your pay", yearly, "risk"),
      short,
      worthCents: yearly,
      worthKind: "risk",
      confidence: capped(
        combine([factEvidence(pattern), factEvidence(profile.facts.monthly_income)]),
        CAPS.disabilityGap,
        "disability cover through your job doesn't show in your bank data",
      ),
      urgency: "later",
      why: `You earn about ${formatCents(Math.round((found.input.yearlyPayCents ?? 0) / 12))} a month and I see no disability policy. ${need.summary} A year without pay would cost ${formatCents(yearly)} of it.`,
      action: OPTIONS("disability"),
    };
  },
};

const liabilityLevels: Detector = {
  capability: "insurance",
  covers: ["insurance_policies"],
  topic: "liability_levels",
  needs: [],
  detect(ctx) {
    const { profile } = ctx;
    const found = needsOf(ctx);
    if (!found) return null;
    const need = found.needs.find((n) => n.kind === "auto_liability" && n.gapCents > 0);
    if (!need) return null;
    return {
      id: suggestionId("insurance", "liability_levels"),
      capability: "insurance",
      topic: "liability_levels",
      title: "Raise your car's injury liability",
      headline: headlineOf("Check your car's injury liability", need.gapCents, "risk"),
      short: `Your injury limits are ${formatCents(need.haveCents)} per accident, under the ${formatCents(need.needCents)} I'd size.`,
      worthCents: need.gapCents,
      worthKind: "risk",
      confidence: capped(
        evidence("seen", profile.months, 1, "policy limits on file"),
        CAPS.liabilityLevels,
        "the limits come from the policy on file, which may be out of date",
      ),
      urgency: "soon",
      why: `${need.summary} If you cause an accident, the other people's medical bills above your limit come out of your own pocket.`,
      action: OPTIONS("auto_liability"),
    };
  },
};

const deductibleFit: Detector = {
  capability: "insurance",
  covers: ["insurance_policies"],
  topic: "deductible_fit",
  needs: [],
  detect(ctx) {
    const { profile, data } = ctx;
    const found = needsOf(ctx);
    if (!found) return null;
    const need = found.needs.find((n) => n.kind === "deductible" && n.direction !== "ok");
    if (!need) return null;
    if (need.direction === "raise") {
      const yearly = outCents(premiums(data, AUTO_HOME));
      const saves = Math.round(yearly * SAVING_RATES.deductibleStepShare);
      if (saves <= 0) return null;
      return {
        id: suggestionId("insurance", "deductible_fit"),
        capability: "insurance",
        topic: "deductible_fit",
        title: "Your cash can carry a higher deductible",
        headline: headlineOf("Check a higher deductible", saves, "saves"),
        short: `Your cash carries a bigger deductible than your ${formatCents(need.haveCents)}.`,
        worthCents: saves,
        worthKind: "saves",
        confidence: capped(
          combine([evidence("seen", profile.months, 1, "cash in your accounts")]),
          CAPS.deductibleFit + 10,
          "the saving is a typical rate, not a quote",
        ),
        urgency: "later",
        why: `${need.summary} One step up${need.stepCents ? `, to ${formatCents(need.stepCents)},` : ""} usually takes about a tenth off the premium, up to ${formatCents(saves)} a year on what you pay now; you'd pay the difference if you claim.`,
        action: OPTIONS("deductible"),
      };
    }
    return {
      id: suggestionId("insurance", "deductible_fit"),
      capability: "insurance",
      topic: "deductible_fit",
      title: "Your deductible is more than your cash carries",
      headline: headlineOf("Check your deductible", need.haveCents - need.needCents, "risk"),
      short: `A ${formatCents(need.haveCents)} deductible is more than you could pay from cash.`,
      worthCents: need.haveCents - need.needCents,
      worthKind: "risk",
      confidence: capped(
        combine([evidence("seen", profile.months, 1, "cash in your accounts")]),
        CAPS.deductibleFit,
        "I can't see savings held elsewhere",
      ),
      urgency: "soon",
      why: `${need.summary} A claim today would leave you ${formatCents(need.haveCents - need.needCents)} short of what the deductible needs.`,
      action: OPTIONS("deductible"),
    };
  },
};

export const COVER_GAP_DETECTORS: readonly Detector[] = [
  disabilityGap,
  liabilityLevels,
  deductibleFit,
];
