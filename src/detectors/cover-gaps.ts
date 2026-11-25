import { LIABILITY_WORTH_CAP_CENTS } from "@/config/insurance";
import { SAVING_RATES } from "@/config/insurance";
import { computeNeeds, needInputFromProfile } from "@/lib/insurance/need";
import { formatCents } from "@/lib/money";
import { personalPay } from "@/profile/pay";
import { type Detector, suggestion } from "./contract";
import { evidence, factEvidence, headlineOf, monthlyChargeYear } from "./helpers";
import { CAPS, capped, combine, premiums } from "./insurance";

// Perfect coverage (spec step 277): a detector for each gap the need calculators find
// (src/lib/insurance/need), so the page, the chat and the nightly scan all work from the same
// numbers. Each opens the option card for its gap. Pure; see ./contract.ts.

// Premium lines by the cover they pay for: a carrier's name alone (State Farm) is both.
const AUTO_ONLY = /\bAUTO\b|\bCAR\b|GEICO|PROGRESSIVE/i;
const HOME_ONLY = /\bHOME\b|HOMEOWNERS?/i;

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
  covers: ["insurance_policies", "insurance_needs"],
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
    const monthly = formatCents(Math.round((found.input.yearlyPayCents ?? 0) / 12));
    const share = personalPay(profile).assumedShare;
    const earn =
      share === null
        ? `You earn about ${monthly} a month`
        : `Your business makes you about ${monthly} a month (${Math.round(share * 100)}% of sales, my estimate)`;
    // Cover on file that pays less than the need isn't "no cover": say what it pays.
    const onFile =
      need.haveCents > 0
        ? `only ${formatCents(need.haveCents)} a month of disability cover on file`
        : "no disability cover on file";
    const short = `${earn}, with ${onFile}.`;
    return suggestion("insurance", "disability_insurance", {
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
      why: `${earn} and ${need.haveCents > 0 ? `the disability cover I see pays ${formatCents(need.haveCents)} a month` : "I see no disability policy"}. ${need.summary} A year without pay would cost ${formatCents(yearly)} of it.`,
      action: OPTIONS("disability"),
    });
  },
};

const liabilityLevels: Detector = {
  capability: "insurance",
  covers: ["insurance_policies", "insurance_needs"],
  topic: "liability_levels",
  needs: [],
  detect(ctx) {
    const { profile } = ctx;
    const found = needsOf(ctx);
    if (!found) return null;
    const need = found.needs.find((n) => n.kind === "auto_liability" && n.gapCents > 0);
    if (!need) return null;
    // A big gap (a rich person's umbrella-sized limit) must not outrank their core money moves.
    const worth = Math.min(need.gapCents, LIABILITY_WORTH_CAP_CENTS);
    return suggestion("insurance", "liability_levels", {
      title: "Raise your car's injury liability",
      headline: headlineOf("Check your car's injury liability", worth, "risk"),
      short: `Your injury limits are ${formatCents(need.haveCents)} per accident, under the ${formatCents(need.needCents)} I'd size.`,
      worthCents: worth,
      worthKind: "risk",
      confidence: capped(
        evidence("seen", profile.months, 1, "policy limits on file"),
        CAPS.liabilityLevels,
        "the limits come from the policy on file, which may be out of date",
      ),
      urgency: "soon",
      why: `${need.summary} If you cause an accident, the other people's medical bills above your limit come out of your own pocket.`,
      action: OPTIONS("auto_liability"),
    });
  },
};

const deductibleFit: Detector = {
  capability: "insurance",
  covers: ["insurance_policies", "insurance_needs"],
  topic: "deductible_fit",
  needs: [],
  detect(ctx) {
    const { profile, data } = ctx;
    const found = needsOf(ctx);
    if (!found) return null;
    // A deductible above what cash comfortably carries comes first, whatever order the policies are in.
    const deductibles = found.needs.filter((n) => n.kind === "deductible" && n.direction !== "ok");
    const need = deductibles.find((n) => n.direction === "lower") ?? deductibles[0];
    if (!need) return null;
    if (need.direction === "raise") {
      // The premiums seen are not a year: put them on a year by the months they were charged in
      // (monthly premiums only), and say nothing of a yearly saving for an annual or a
      // quarterly premium or with under 3 months of them.
      // Of the policy whose deductible would change: a home premium does not fall when the car's
      // deductible goes up. A kind whose premiums can't be told apart by name has no figure.
      const kind = found.input.policies.find((p) => p.id === need.policyId)?.kind;
      const pattern = kind === "auto" ? AUTO_ONLY : kind === "home" ? HOME_ONLY : null;
      // Two policies of one kind pay into one stream this detector can't split: no figure. A
      // carrier's name alone (GEICO) beside an explicit home line is the home policy's premium.
      const shared = found.input.policies.filter((p) => p.kind === kind).length > 1;
      const yearly =
        pattern && !shared
          ? monthlyChargeYear(
              premiums(data, pattern).filter(
                (t) => kind !== "auto" || !HOME_ONLY.test(t.description),
              ),
            )
          : null;
      if (yearly === null) return null;
      const saves = Math.round(yearly * SAVING_RATES.deductibleStepShare);
      if (saves <= 0) return null;
      return suggestion("insurance", "deductible_fit", {
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
      });
    }
    return suggestion("insurance", "deductible_fit", {
      title: "Your deductible is more than your cash comfortably carries",
      headline: headlineOf("Check your deductible", need.haveCents - need.needCents, "risk"),
      // Above what cash comfortably carries, not "more than you could pay": the cash may cover it.
      short: `A ${formatCents(need.haveCents)} deductible is more than your cash comfortably carries.`,
      worthCents: need.haveCents - need.needCents,
      worthKind: "risk",
      confidence: capped(
        combine([evidence("seen", profile.months, 1, "cash in your accounts")]),
        CAPS.deductibleFit,
        "I can't see savings held elsewhere",
      ),
      urgency: "soon",
      why: `${need.summary} It's ${formatCents(need.haveCents - need.needCents)} above what your cash comfortably carries.`,
      action: OPTIONS("deductible"),
    });
  },
};

export const COVER_GAP_DETECTORS: readonly Detector[] = [
  disabilityGap,
  liabilityLevels,
  deductibleFit,
];
