import { DETECTOR_RATES } from "@/config/detectors";
import { SPENDING_DETECTOR_RATES as S } from "@/config/detectors-spending";
import { CA_CARE_FERA, caLimit } from "@/config/utility-assistance";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, headlineOf, nice, outCents, tx, weakest } from "./helpers";

// Utilities (connectors roadmap round 17). Read only, no vendor, no Claude call. Pure; see
// ./contract.ts.

const ENERGY = "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY";

// A gas or electric bill that swings with the seasons (budget_billing_hint): many utilities offer
// budget (level) billing, the same amount each month from the yearly average, trued up once a year.
// It costs nothing and saves nothing: it evens out the big months. Worth what the biggest month
// runs over the average.
const budgetBilling: Detector = {
  capability: "cost",
  topic: "budget_billing",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const byPayee = new Map<string, Map<string, number>>();
    for (const t of tx(data, (x) => x.pfc === ENERGY && x.amountCents > 0)) {
      const months = byPayee.get(t.description) ?? new Map<string, number>();
      const month = t.date.slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + t.amountCents);
      byPayee.set(t.description, months);
    }
    const swings = [...byPayee.entries()]
      .map(([payee, months]) => {
        const totals = [...months.values()];
        const max = Math.max(...totals);
        const min = Math.min(...totals);
        const average = Math.round(totals.reduce((s, n) => s + n, 0) / totals.length);
        return { payee, months: totals.length, max, min, average, jump: max - average };
      })
      .filter(
        (p) =>
          p.months >= S.budgetBillingMonthsMin &&
          p.min > 0 &&
          p.max >= p.min * S.budgetBillingSwingRatio &&
          p.jump >= S.budgetBillingMinJumpCents,
      )
      .sort((a, b) => b.jump - a.jump);
    const top = swings[0];
    if (!top) return null;
    const name = nice(top.payee);
    return {
      id: suggestionId("cost", "budget_billing"),
      capability: "cost",
      topic: "budget_billing",
      title: `Even out your ${name} bill with budget billing`,
      headline: headlineOf(`Even out your ${name} bill`, top.jump, "risk"),
      short: `Your ${name} bill ran from ${formatCents(top.min)} to ${formatCents(top.max)} a month.`,
      worthCents: top.jump,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, top.months, `months of ${name} bills`),
      urgency: "later",
      why: `Your ${name} bill ran from ${formatCents(top.min)} to ${formatCents(top.max)} a month over ${top.months} months, about ${formatCents(top.average)} on average. Many utilities offer budget (level) billing: about the same amount each month from your yearly average, settled up once a year. It doesn't lower the total; it takes the ${formatCents(top.jump)} jump out of the biggest month. Ask ${name}, or look for it in your account online.`,
      action: { label: "See your bills", href: "/bills" },
    };
  },
};

// California's CARE and FERA (utility_discount_eligibility_hint): a household in California whose
// gross income looks to be under the limit for its size may qualify for a discount on its energy
// bills. "May": the utility decides, and CARE also qualifies through SNAP, Medi-Cal and others.
// Needs the state and household size from the tax profile. Worth the lowest discount on a year of
// the person's own gas and electric bills.
const careDiscount: Detector = {
  capability: "cost",
  topic: "utility_discount",
  covers: [],
  needs: ["monthly_income"],
  detect({ profile, data }) {
    if (data.state !== CA_CARE_FERA.state || !data.householdSize) return null;
    if (data.today < CA_CARE_FERA.from || data.today > CA_CARE_FERA.until) return null;
    const monthly = profile.facts.monthly_income.value;
    if (typeof monthly !== "number" || monthly <= 0) return null;
    const energy = outCents(tx(data, (t) => t.pfc === ENERGY && t.amountCents > 0));
    if (energy <= 0) return null;
    const yearlyEnergy = Math.round((energy * 12) / Math.max(1, profile.months));
    const gross = Math.round(monthly * 12 * DETECTOR_RATES.tax.netToGross);
    const people = data.householdSize;
    const care = caLimit(CA_CARE_FERA.care, people);
    const fera = caLimit(CA_CARE_FERA.fera, people);
    const program =
      gross <= care
        ? "CARE"
        : people >= CA_CARE_FERA.fera.minPeople && gross <= fera
          ? "FERA"
          : null;
    if (!program) return null;
    const rule = program === "CARE" ? CA_CARE_FERA.care : CA_CARE_FERA.fera;
    const limit = program === "CARE" ? care : fera;
    const worth = Math.round(yearlyEnergy * rule.lowestDiscount);
    return {
      id: suggestionId("cost", "utility_discount"),
      capability: "cost",
      topic: "utility_discount",
      title: `Your household may qualify for California's ${program} discount on energy bills`,
      headline: headlineOf(`Check the ${program} energy discount`, worth, "saves"),
      short: `Income near ${formatCents(gross)} for ${people} ${people === 1 ? "person" : "people"} is under ${program}'s ${formatCents(limit)} limit.`,
      worthCents: worth,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(profile.facts.monthly_income),
        {
          percent: 50,
          reason: "the limit is on gross household income, estimated here from your pay",
        },
      ]),
      urgency: "later",
      why: `For a household of ${people}, ${program} takes gross yearly income up to ${formatCents(limit)} (${CA_CARE_FERA.from} to ${CA_CARE_FERA.until}); yours looks to be near ${formatCents(gross)}. ${program === "CARE" ? "CARE takes 30-35% off electric and 20% off gas" : "FERA takes 18% off electric"}: on your ${formatCents(yearlyEnergy)} a year of gas and electric, at least ${formatCents(worth)}. Your utility decides; you apply with it${program === "CARE" ? ", and getting SNAP, Medi-Cal or similar help can also qualify you" : ""}.`,
      action: { label: "See your bills", href: "/bills" },
      more: [{ label: `About ${program}`, href: rule.url }],
    };
  },
};

export const UTILITY_DETECTORS: readonly Detector[] = [budgetBilling, careDiscount];
