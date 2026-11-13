import { DETECTOR_RATES } from "@/config/detectors";
import { SPENDING_DETECTOR_RATES as S } from "@/config/detectors-spending";
import {
  CA_CARE_FERA,
  LIFELINE,
  LOW_COST_INTERNET,
  caLimit,
  povertyLine,
} from "@/config/utility-assistance";
import { formatCents } from "@/lib/money";
import { type Detector, suggestion } from "./contract";
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
    return suggestion("cost", "budget_billing", {
      title: `Even out your ${name} bill with budget billing`,
      headline: headlineOf(`Even out your ${name} bill`, top.jump, "risk"),
      short: `Your ${name} bill ran from ${formatCents(top.min)} to ${formatCents(top.max)} a month.`,
      worthCents: top.jump,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, top.months, `months of ${name} bills`),
      urgency: "later",
      why: `Your ${name} bill ran from ${formatCents(top.min)} to ${formatCents(top.max)} a month over ${top.months} months, about ${formatCents(top.average)} on average. Many utilities offer budget (level) billing: about the same amount each month from your yearly average, settled up once a year. It doesn't lower the total; it takes the ${formatCents(top.jump)} jump out of the biggest month. Ask ${name}, or look for it in your account online.`,
      action: { label: "See your bills", href: "/bills" },
    });
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
    return suggestion("cost", "utility_discount", {
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
    });
  },
};

const INTERNET = "RENT_AND_UTILITIES_INTERNET_AND_CABLE";
const PHONE = "RENT_AND_UTILITIES_TELEPHONE";

// How many people the household has: the tax profile's count, else one for a single person and two
// for a couple; a family of unknown size isn't guessed.
function householdOf(data: { householdSize?: number | null }, household: unknown): number | null {
  if (data.householdSize) return data.householdSize;
  return household === "single" ? 1 : household === "couple" ? 2 : null;
}

// Gross yearly household income from take-home pay, as the other income-tested cards read it.
const grossOf = (monthly: unknown) =>
  typeof monthly === "number" && monthly > 0
    ? Math.round(monthly * 12 * DETECTOR_RATES.tax.netToGross)
    : null;

// Lifeline (lifeline_eligibility_hint): a household whose income looks to be at or under 135% of the
// poverty line, paying for phone or internet, may qualify for up to $9.25 a month off.
const lifeline: Detector = {
  capability: "cost",
  topic: "lifeline",
  covers: [],
  needs: ["monthly_income"],
  detect({ profile, data }) {
    if (data.state && (LIFELINE.excludedStates as readonly string[]).includes(data.state))
      return null;
    const people = householdOf(data, profile.facts.household.value);
    const gross = grossOf(profile.facts.monthly_income.value);
    if (!people || gross === null) return null;
    const pays = tx(data, (t) => (t.pfc === PHONE || t.pfc === INTERNET) && t.amountCents > 0);
    if (pays.length === 0) return null;
    const limit = povertyLine(people, LIFELINE.incomeShare);
    if (gross > limit) return null;
    const yearly = LIFELINE.monthlyCents * 12;
    return suggestion("cost", "lifeline", {
      title: "Your household may qualify for Lifeline: money off a phone or internet bill",
      headline: headlineOf("Check Lifeline for your phone bill", yearly, "saves"),
      short: `Income near ${formatCents(gross)} for ${people} is under Lifeline's ${formatCents(limit)} line.`,
      worthCents: yearly,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(profile.facts.monthly_income),
        { percent: 50, reason: "the limit is on household income, estimated here from your pay" },
      ]),
      urgency: "later",
      why: `For a household of ${people}, Lifeline takes income up to ${formatCents(limit)} a year (135% of the poverty line); yours looks to be near ${formatCents(gross)}. It takes up to $9.25 a month off one phone or internet bill per household, and getting SNAP, Medicaid, SSI, Federal Public Housing or a VA pension also qualifies. You apply yourself through the FCC's National Verifier.`,
      action: { label: "See your bills", href: "/bills" },
      more: [
        { label: "Apply: National Verifier", href: LIFELINE.apply },
        { label: "Who qualifies", href: LIFELINE.url },
      ],
    });
  },
};

// A provider's own low-income internet plan (low_cost_internet_hint): the person's internet bill is
// with a provider that has one, and their income looks to be at or under its 200% line.
const lowCostInternet: Detector = {
  capability: "cost",
  topic: "low_cost_internet",
  covers: [],
  needs: ["monthly_income"],
  detect({ profile, data }) {
    const people = householdOf(data, profile.facts.household.value);
    const gross = grossOf(profile.facts.monthly_income.value);
    if (!people || gross === null) return null;
    const bills = tx(data, (t) => t.pfc === INTERNET && t.amountCents > 0);
    const plan = LOW_COST_INTERNET.plans.find((p) =>
      bills.some((t) => p.match.test(`${t.description} ${t.merchantName ?? ""}`)),
    );
    if (!plan) return null;
    const limit = povertyLine(people, LOW_COST_INTERNET.incomeShare);
    if (gross > limit) return null;
    const paid = bills.filter((t) => plan.match.test(`${t.description} ${t.merchantName ?? ""}`));
    const monthly = Math.round(
      outCents(paid) / Math.max(1, new Set(paid.map((t) => t.date.slice(0, 7))).size),
    );
    const off = "priceCents" in plan ? monthly - plan.priceCents : Math.min(plan.offCents, monthly);
    if (off <= 0) return null;
    return suggestion("cost", "low_cost_internet", {
      title: `${plan.isp} has a low-income internet plan your household may qualify for`,
      headline: headlineOf(`Check ${plan.isp}'s low-cost internet`, off * 12, "saves"),
      short: `You pay ${plan.isp} about ${formatCents(monthly)} a month; ${plan.plan}.`,
      worthCents: off * 12,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(profile.facts.monthly_income),
        evidence("seen", profile.months, paid.length, `${plan.isp} bills`),
        { percent: 50, reason: "the limit is on household income, estimated here from your pay" },
      ]),
      urgency: "later",
      why: `You pay ${plan.isp} about ${formatCents(monthly)} a month for internet. ${plan.isp} offers ${plan.plan}, for households at or under 200% of the poverty line (${formatCents(limit)} a year for ${people}) or getting help like SNAP; yours looks to be near ${formatCents(gross)}. ${plan.isp} decides who qualifies, and its terms are its own.`,
      action: { label: "See your bills", href: "/bills" },
      more: [{ label: `About ${plan.isp}'s plan`, href: plan.url }],
    });
  },
};

export const UTILITY_DETECTORS: readonly Detector[] = [
  budgetBilling,
  careDiscount,
  lifeline,
  lowCostInternet,
];
