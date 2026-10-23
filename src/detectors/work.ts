import { DETECTOR_RATES as R } from "@/config/detectors";
import { RISK_ANNUAL_PROBABILITY as CHANCE } from "@/config/suggestions";
import { BUSINESS_SALES_DEPOSIT } from "@/config/insurance";
import { computeNeeds, needInputFromProfile } from "@/lib/insurance/need";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, tx, weakest, headlineOf } from "./helpers";
import { daysToEstimatedDate, urgencyForEstimated } from "./taxes";

// Detectors for how a person earns (spec step 254): taxes with no employer, saving for
// retirement alone, uneven pay, a business mixed with home, company stock. Pure; see
// ./contract.ts.

const selfPaid = (pattern: unknown) => pattern === "uneven" || pattern === "business";
const annualIncome = (monthly: unknown) => (typeof monthly === "number" ? monthly * 12 : 0);

const estimatedTaxes: Detector = {
  covers: ["tax_estimate", "tax_self_employed", "tax_calendar"],
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
    // A shop's deposits are sales, not profit: tax is owed on what's left after costs, which
    // Jane can't see, so she assumes a share and says so.
    const business = pattern.value === "business";
    const taxable = Math.round(
      annualIncome(income.value) * (business ? R.tax.businessProfitShare : 1),
    );
    const owed = Math.round(taxable * R.selfEmployedTaxRate);
    return {
      id: suggestionId("taxes", "estimated_taxes"),
      capability: "taxes",
      topic: "estimated_taxes",
      title: "Pay estimated taxes each quarter",
      headline: headlineOf(
        "Pay estimated taxes each quarter",
        Math.round(owed * R.underpaymentPenaltyRate),
        "risk",
      ),
      short: `Nobody withholds tax from your pay; about ${formatCents(owed)} a year is due.`,
      worthCents: Math.round(owed * R.underpaymentPenaltyRate),
      worthKind: "risk",
      // The tax is owed whatever she does; planning for it avoids the penalty and the surprise,
      // so it counts for a share of the bill in ranking.
      rankCents: Math.round(owed * R.tax.rankShareOfBill),
      confidence: weakest([
        factEvidence(pattern),
        factEvidence(income),
        evidence("seen", profile.months, 0, "income-tax payments"),
        ...(business
          ? [
              {
                percent: 60,
                reason: `your deposits are sales, so I assumed ${Math.round(R.tax.businessProfitShare * 100)}% is profit`,
              },
            ]
          : []),
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
    // A shop's deposits are sales, not profit (the same assumption as the estimated taxes): a
    // tenth is of what's left after costs, so the confidence says it is an assumption.
    const business = pattern.value === "business";
    const profit = Math.round(
      annualIncome(income.value) * (business ? R.tax.businessProfitShare : 1),
    );
    const put = Math.round(profit * R.selfRetireShare);
    return {
      id: suggestionId("investing", "retirement_self_employed"),
      capability: "investing",
      topic: "retirement_self_employed",
      title: "Open a retirement account for the self-employed",
      headline: headlineOf(
        "Open a self-employed retirement account",
        Math.round(put * R.selfRetireTaxRate),
        "saves",
      ),
      short: `Putting in ${formatCents(put)} a year would cut your tax by about ${formatCents(Math.round(put * R.selfRetireTaxRate))}.`,
      worthCents: Math.round(put * R.selfRetireTaxRate),
      worthKind: "saves",
      confidence: weakest([
        factEvidence(pattern),
        factEvidence(has401k),
        factEvidence(income),
        ...(business
          ? [
              {
                percent: 60,
                reason: `your deposits are sales, so I assumed ${Math.round(R.tax.businessProfitShare * 100)}% is profit`,
              },
            ]
          : []),
      ]),
      urgency: "later",
      why: `You work for yourself and I see no retirement account. Putting in ${formatCents(put)} a year (a tenth of ${business ? "what the business earns, about " + formatCents(profit) : "your income"}) would cut your tax by about ${formatCents(Math.round(put * R.selfRetireTaxRate))}.`,
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
      headline: headlineOf("Pay yourself a steady amount", Math.round(average - lowest), "risk"),
      short: `Your income averages ${formatCents(Math.round(average))} a month; your lowest was ${formatCents(Math.round(lowest))}.`,
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
      headline: headlineOf(
        "Separate business and personal money",
        Math.round(total * R.selfEmployedTaxRate),
        "risk",
      ),
      short: `${personal.length} personal payments (${formatCents(total)}) came out alongside your shop's money.`,
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

// Spec step 201: a business or side work needs cover no personal policy gives. From the need
// calculators (src/lib/insurance/need), the same working as the page and the chat: general
// liability for clients or customers, professional liability for work done for clients, and
// work equipment. Without the policies loaded, a business owner with no business insurance
// charge in their payments.
const BUSINESS_NEEDS: readonly string[] = [
  "business_liability",
  "professional_liability",
  "business_equipment",
];
const NEED_WORDS: Record<string, string> = {
  business_liability: "general",
  professional_liability: "professional",
  business_equipment: "equipment",
};
const businessInsurance: Detector = {
  covers: ["insurance_risks", "insurance_needs"],
  capability: "insurance",
  topic: "business_insurance",
  needs: ["income_pattern"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    const income = profile.facts.monthly_income;
    const input = needInputFromProfile(profile, data);
    if (input) {
      const short = computeNeeds(input).filter(
        (n) => BUSINESS_NEEDS.includes(n.kind) && n.gapCents > 0,
      );
      if (short.length === 0) return null;
      const work = input.business!;
      const yearly = (cents: number) => Math.round((cents * 12) / Math.max(1, profile.months));
      const shop = work.salesCents > work.serviceCents;
      const seen = data.transactions.filter(
        (t) =>
          t.amountCents < 0 &&
          (t.pfc === "INCOME_CONTRACTOR" ||
            t.pfc === "INCOME_GIG_ECONOMY" ||
            (t.pfc === "INCOME_OTHER" && BUSINESS_SALES_DEPOSIT.test(t.description))),
      ).length;
      // "no general or professional liability cover", "no equipment cover".
      const missing = short.map((n) => NEED_WORDS[n.kind]);
      const liability = missing.filter((m) => m !== "equipment");
      const list = [
        ...(liability.length > 0 ? [`${liability.join(" or ")} liability`] : []),
        ...(missing.includes("equipment") ? ["equipment"] : []),
      ].join(" or ");
      return {
        id: suggestionId("insurance", "business_insurance"),
        capability: "insurance",
        topic: "business_insurance",
        title: shop
          ? "Check your business has liability and property cover"
          : "Get cover for the work you do for clients",
        headline: headlineOf("Check your business cover", R.businessClaimCents, "risk"),
        short: `${shop ? `Your business takes about ${formatCents(yearly(work.salesCents))} a year in card sales` : `You earn about ${formatCents(yearly(work.serviceCents))} a year from client work`} with no ${list} cover.`,
        worthCents: R.businessClaimCents,
        // A business with no liability cover at all can be ended by one claim.
        required: short.some((n) => n.kind === "business_liability" && n.haveCents === 0),
        worthKind: "risk",
        confidence: weakest([
          evidence("seen", profile.months, seen, "business income deposits"),
          ...(pattern.value === "business" ? [factEvidence(pattern)] : []),
        ]),
        urgency: "soon",
        why: `${short[0].summary} ${shop ? "A customer hurt at your business, or by what you sell," : "A client who says your work cost them money, or who is hurt while you work,"} is a claim your home, renters and car policies don't pay. One in a given year is unlikely (about ${Math.round(CHANCE.business_insurance * 100)}%), but it can cost ${formatCents(R.businessClaimCents)} or more.`,
        action: { label: "See options", href: `/insurance?need=${short[0].kind}#options` },
      };
    }
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
      headline: headlineOf("Check your business cover", R.businessClaimCents, "risk"),
      short: `Your business takes in about ${formatCents(annualIncome(income.value))} a year and I see no insurance charge.`,
      worthCents: R.businessClaimCents,
      required: true,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(pattern),
        evidence("seen", profile.months, 0, "business-cover charges"),
      ]),
      urgency: "soon",
      why: `Your business takes in about ${formatCents(annualIncome(income.value))} a year and I see no business insurance charge in ${profile.months} months. A liability claim in a given year is unlikely (about ${Math.round(CHANCE.business_insurance * 100)}%), but one can cost ${formatCents(R.businessClaimCents)} or more.`,
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
      headline: headlineOf(
        "Spread out your company stock",
        Math.round(stock * R.concentrationDropShare),
        "risk",
      ),
      short: `Your company stock is ${formatCents(stock)}, ${Math.round((stock / invested) * 100)}% of what you invest.`,
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
