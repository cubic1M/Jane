import { DETECTOR_RATES as R } from "@/config/detectors";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, tx, weakest } from "./helpers";
import { daysToEstimatedDate, urgencyForEstimated } from "./taxes";

// Detectors for how a person earns (spec step 254): taxes with no employer, saving for
// retirement alone, uneven pay, a business mixed with home, company stock. Pure; see
// ./contract.ts.

const selfPaid = (pattern: unknown) => pattern === "uneven" || pattern === "business";
const annualIncome = (monthly: unknown) => (typeof monthly === "number" ? monthly * 12 : 0);

const estimatedTaxes: Detector = {
  covers: ["tax_estimate", "tax_self_employed"],
  capability: "taxes",
  topic: "estimated_taxes",
  needs: ["income_pattern", "monthly_income"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    const income = profile.facts.monthly_income;
    if (!selfPaid(pattern.value)) return null;
    const paid = tx(
      data,
      (t) => t.pfc === "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" && !/SALES TAX/i.test(t.description),
    );
    if (paid.length > 0) return null;
    const owed = Math.round(annualIncome(income.value) * R.selfEmployedTaxRate);
    return {
      id: suggestionId("taxes", "estimated_taxes"),
      capability: "taxes",
      topic: "estimated_taxes",
      title: "Pay estimated taxes each quarter",
      worthCents: Math.round(owed * R.underpaymentPenaltyRate),
      worthKind: "risk",
      confidence: weakest([
        factEvidence(pattern),
        factEvidence(income),
        evidence("seen", profile.months, 0, "income-tax payments"),
      ]),
      // The next quarterly date drives it: now within two weeks, soon within six.
      urgency: urgencyForEstimated(profile.today),
      why: `Nobody withholds tax from your pay and I see no tax payments in ${profile.months} months. On about ${formatCents(owed)} of tax a year, late payment penalties could reach ${formatCents(Math.round(owed * R.underpaymentPenaltyRate))}. The next payment is due in ${daysToEstimatedDate(profile.today)} days.`,
      action: { label: "Set aside tax", href: "/taxes" },
    };
  },
};

const selfRetirement: Detector = {
  covers: ["retirement_accounts"],
  capability: "investing",
  topic: "retirement_self_employed",
  needs: ["income_pattern", "has_401k"],
  detect({ profile }) {
    const pattern = profile.facts.income_pattern;
    const has401k = profile.facts.has_401k;
    const income = profile.facts.monthly_income;
    if (!selfPaid(pattern.value) || has401k.value !== false) return null;
    const put = Math.round(annualIncome(income.value) * R.selfRetireShare);
    return {
      id: suggestionId("investing", "retirement_self_employed"),
      capability: "investing",
      topic: "retirement_self_employed",
      title: "Open a retirement account for the self-employed",
      worthCents: Math.round(put * R.selfRetireTaxRate),
      worthKind: "saves",
      confidence: weakest([factEvidence(pattern), factEvidence(has401k), factEvidence(income)]),
      urgency: "later",
      why: `You work for yourself and I see no retirement account. Putting in ${formatCents(put)} a year (a tenth of your income) would cut your tax by about ${formatCents(Math.round(put * R.selfRetireTaxRate))}.`,
      action: { label: "See account options", href: "/investments" },
    };
  },
};

const incomeSmoothing: Detector = {
  covers: ["steady_pay"],
  capability: "steady_pay",
  topic: "income_smoothing",
  needs: ["income_pattern"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    if (pattern.value !== "uneven") return null;
    const byMonth = new Map<string, number>();
    for (const t of tx(data, (x) => x.amountCents < 0 && (x.pfc ?? "").startsWith("INCOME_"))) {
      const month = t.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) - t.amountCents);
    }
    const totals = [...byMonth.values()];
    if (totals.length < 2) return null;
    const average = totals.reduce((a, b) => a + b, 0) / totals.length;
    const lowest = Math.min(...totals);
    if ((average - lowest) / average < R.smoothingMinMonthlySwingShare) return null;
    return {
      id: suggestionId("steady_pay", "income_smoothing"),
      capability: "steady_pay",
      topic: "income_smoothing",
      title: "Pay yourself a steady amount from your uneven income",
      worthCents: Math.round(average - lowest),
      worthKind: "risk",
      confidence: weakest([
        factEvidence(pattern),
        evidence("seen", profile.months, totals.length, "months of income"),
      ]),
      urgency: "later",
      why: `Your income averages ${formatCents(Math.round(average))} a month but your lowest month was ${formatCents(Math.round(lowest))}. A steady monthly pay from a buffer evens that out.`,
      action: { label: "Set up steady pay", href: "/transfers" },
    };
  },
};

const businessSeparation: Detector = {
  covers: ["tax_side_income"],
  capability: "taxes",
  topic: "business_separation",
  needs: ["income_pattern"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    if (pattern.value !== "business") return null;
    const personal = tx(
      data,
      (t) =>
        t.amountCents > 0 &&
        (t.pfc === "FOOD_AND_DRINK_GROCERIES" || /HOME RENT/i.test(t.description)),
    );
    if (personal.length === 0) return null;
    const total = personal.reduce((s, t) => s + t.amountCents, 0);
    return {
      id: suggestionId("taxes", "business_separation"),
      capability: "taxes",
      topic: "business_separation",
      title: "Keep business and personal money in separate accounts",
      worthCents: Math.round(total * R.selfEmployedTaxRate),
      worthKind: "risk",
      confidence: weakest([
        factEvidence(pattern),
        evidence(
          "seen",
          profile.months,
          personal.length,
          "personal payments from the business account",
        ),
      ]),
      urgency: "later",
      why: `${personal.length} personal payments (${formatCents(total)}) came out alongside your shop's money. Mixing them blurs your taxes and your liability.`,
      action: { label: "See your accounts", href: "/connect" },
    };
  },
};

const businessInsurance: Detector = {
  covers: ["insurance_risks"],
  capability: "insurance",
  topic: "business_insurance",
  needs: ["income_pattern"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    const income = profile.facts.monthly_income;
    if (pattern.value !== "business") return null;
    const cover = tx(
      data,
      (t) =>
        t.pfc === "GENERAL_SERVICES_INSURANCE" &&
        /BUSINESS|LIABILITY|COMMERCIAL|PROPERTY/i.test(t.description),
    );
    if (cover.length > 0) return null;
    return {
      id: suggestionId("insurance", "business_insurance"),
      capability: "insurance",
      topic: "business_insurance",
      title: "Check your business has liability and property cover",
      worthCents: annualIncome(income.value),
      worthKind: "risk",
      confidence: weakest([
        factEvidence(pattern),
        evidence("seen", profile.months, 0, "business-cover charges"),
      ]),
      urgency: "soon",
      why: `Your business takes in about ${formatCents(annualIncome(income.value))} a year and I see no business insurance charge in ${profile.months} months.`,
      action: { label: "Check your cover", href: "/insurance/checkup" },
    };
  },
};

const concentration: Detector = {
  covers: ["company_stock"],
  capability: "investing",
  topic: "concentration",
  needs: ["has_stock_plan"],
  detect({ profile, data }) {
    const plan = profile.facts.has_stock_plan;
    if (plan.value !== true) return null;
    const invested = data.accounts
      .filter((a) => a.type === "investment")
      .reduce((s, a) => s + a.balanceCents, 0);
    const stock = data.accounts
      .filter((a) => a.subtype === "stock plan")
      .reduce((s, a) => s + a.balanceCents, 0);
    if (invested === 0 || stock / invested < R.concentrationShare) return null;
    return {
      id: suggestionId("investing", "concentration"),
      capability: "investing",
      topic: "concentration",
      title: "Spread out your company stock",
      worthCents: Math.round(stock * R.concentrationDropShare),
      worthKind: "risk",
      confidence: factEvidence(plan),
      urgency: "soon",
      why: `Your company stock is ${formatCents(stock)}, ${Math.round((stock / invested) * 100)}% of everything you invest. If it fell by ${Math.round(R.concentrationDropShare * 100)}% you would lose ${formatCents(Math.round(stock * R.concentrationDropShare))}, and your job rides on the same company.`,
      action: { label: "See your holdings", href: "/investments" },
    };
  },
};

export const WORK_DETECTORS: readonly Detector[] = [
  estimatedTaxes,
  selfRetirement,
  incomeSmoothing,
  businessSeparation,
  businessInsurance,
  concentration,
];
