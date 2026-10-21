import { DETECTOR_RATES } from "@/config/detectors";
import { HOME_OFFICE_ASSUMED_SQFT, VEHICLE_ASSUMED_MILES } from "@/config/business-structure";
import {
  ASSUMED_APTC_MONTHLY_CENTS,
  MARKETPLACE_PAYEE,
  PTC_CLIFF,
  fplFor,
} from "@/config/health-taxes";
import { GIVING } from "@/config/giving";
import {
  INHERITED_IRA_YEARS,
  INHERITED_NAME,
  MISSED_WITHDRAWAL_PENALTY,
} from "@/config/inheritance";
import { PROPERTY_TAX_PAYEE } from "@/config/home-taxes";
import { APPEAL_GAP_RATE } from "@/config/property-tax";
import { TAXABLE_INVESTMENT_SUBTYPES } from "@/config/tax";
import { ESTIMATED_TAX_DATES } from "@/config/tax-pack";
import {
  CONTRIBUTION_LIMITS,
  DEPENDENT_CARE_CREDIT,
  FEDERAL_BRACKETS,
  HOME_OFFICE_SIMPLIFIED,
  MILEAGE_RATE_CENTS,
  PAYROLL_TAX,
  SELF_EMPLOYMENT_TAX,
  STANDARD_DEDUCTION,
} from "@/config/tax-rates";
import { formatCents } from "@/lib/money";
import { structureFor } from "@/planning/business-structure";
import { hsaExcess } from "@/planning/health-taxes";
import { mustBeEmptyBy, spreadIra } from "@/planning/inheritance";
import { NO_INCOME, marginalRateOf, type EstimateInput } from "@/planning/tax-estimate";
import { careShare } from "@/planning/tax-savings";
import type { Fact } from "@/profile/build";
import { type Detector, type Urgency, suggestionId } from "./contract";
import { evidence, factEvidence, tx, weakest } from "./helpers";

// Detectors for taxes (spec step 261), over what a person's profile and rows show: the pay
// withheld on company stock, Roth conversions near retirement, childcare paid for with after-
// tax money, the identity protection PIN in its season, and the deadline that drives the
// estimated-payment detector's urgency (./work.ts). Pure; see ./contract.ts and
// docs/detectors/taxes.md for what each looks at, what it is worth and who it should and
// should not reach. Rates are in src/config/detectors.ts; dated tax figures come from
// src/config/tax-rates.ts.

const T = DETECTOR_RATES.tax;
const annual = (monthly: unknown) => (typeof monthly === "number" ? monthly * 12 : 0);
const month = (today: string) => Number(today.slice(5, 7));

// A single or a joint return, from the household fact (a couple or a family files jointly).
const statusOf = (household: unknown) =>
  household === "couple" || household === "family" ? "married_joint" : "single";

// The top federal bracket a person's income reaches, from their take-home pay.
function marginalRate(netAnnualCents: number, extraCents: number, household: unknown) {
  const status = statusOf(household);
  const gross = Math.round(netAnnualCents * T.netToGross) + extraCents;
  return marginalRateOf(Math.max(0, gross - STANDARD_DEDUCTION[status]), FEDERAL_BRACKETS[status]);
}

// Gross income for brackets: take-home pay grossed up (pensions and Social Security arrive
// gross), plus a year's vesting when there is a stock plan (about a quarter of it).
function grossIncome(
  profile: { facts: Record<string, { value: unknown }> },
  data: { accounts: readonly { subtype: string | null; balanceCents: number }[] },
): number {
  const net = annual(profile.facts.monthly_income.value);
  const gross =
    profile.facts.income_pattern.value === "pension" ? net : Math.round(net * T.netToGross);
  const stock =
    profile.facts.has_stock_plan.value === true
      ? data.accounts
          .filter((a) => a.subtype === "stock plan")
          .reduce((s, a) => s + a.balanceCents, 0)
      : 0;
  return gross + Math.round(stock * T.stockVestShare);
}
const bracketOf = (
  profile: Parameters<typeof grossIncome>[0],
  data: Parameters<typeof grossIncome>[1],
) => {
  const status = statusOf(profile.facts.household.value);
  return marginalRateOf(
    Math.max(0, grossIncome(profile, data) - STANDARD_DEDUCTION[status]),
    FEDERAL_BRACKETS[status],
  );
};

// Days from today to the next estimated-payment date (April 15, June 15, September 15,
// January 15), counting this year's and next year's.
export function daysToEstimatedDate(today: string): number {
  const year = Number(today.slice(0, 4));
  const dates = [year - 1, year, year + 1].flatMap((y) =>
    ESTIMATED_TAX_DATES.map(
      (d) =>
        `${y + (d.nextYear ? 1 : 0)}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`,
    ),
  );
  const next = dates.filter((d) => d >= today).sort()[0];
  return Math.round((Date.parse(next) - Date.parse(today)) / 86_400_000);
}

export function urgencyForEstimated(today: string): Urgency {
  const days = daysToEstimatedDate(today);
  return days <= T.estimatedNowDays ? "now" : days <= T.estimatedSoonDays ? "soon" : "later";
}

// Company stock paid as RSUs is withheld at a flat rate; a person in a higher bracket owes
// the difference at filing (steps 120 and 219).
const withholdingGap: Detector = {
  capability: "taxes",
  topic: "withholding_gap",
  covers: ["tax_equity", "tax_withholding"],
  needs: ["has_stock_plan", "monthly_income", "household"],
  detect({ profile, data }) {
    const plan = profile.facts.has_stock_plan;
    const income = profile.facts.monthly_income;
    if (plan.value !== true) return null;
    const stock = data.accounts
      .filter((a) => a.subtype === "stock plan")
      .reduce((s, a) => s + a.balanceCents, 0);
    if (stock <= 0) return null;
    const vested = Math.round(stock * T.stockVestShare);
    const rate = marginalRate(annual(income.value), vested, profile.facts.household.value);
    if (rate <= T.rsuFlatWithholding + 0.005) return null;
    const short = Math.round(vested * (rate - T.rsuFlatWithholding));
    return {
      id: suggestionId("taxes", "withholding_gap"),
      capability: "taxes",
      topic: "withholding_gap",
      title: "Set aside the tax your stock vests won't have withheld",
      // The bill itself can't be saved; planning for it avoids the penalty and the surprise,
      // so it counts for a share of its size in ranking.
      worthCents: short,
      worthKind: "risk",
      rankCents: Math.round(short * T.rankShareOfBill),
      confidence: weakest([
        factEvidence(plan),
        factEvidence(income),
        {
          percent: Math.min(plan.confidence, 70),
          reason: `no vest schedule yet, so I assumed ${Math.round(T.stockVestShare * 100)}% of your ${formatCents(stock)} plan vests this year`,
        },
      ]),
      urgency: month(profile.today) >= 10 ? "soon" : "later",
      why: `Your company stock is withheld at ${Math.round(T.rsuFlatWithholding * 100)} cents on the dollar when it vests, but with your pay plus the vesting you're in the ${Math.round(rate * 100)}% bracket. On about ${formatCents(vested)} vesting, that leaves roughly ${formatCents(short)} to pay when you file. Setting it aside through the year, or paying an estimate, avoids a penalty of about ${formatCents(Math.round(short * DETECTOR_RATES.underpaymentPenaltyRate))} on top.`,
      action: { label: "See what to set aside", href: "/taxes/equity" },
    };
  },
};

const PRETAX = /^(401k|403b|457b|ira|sep ira|simple ira|traditional ira|thrift savings plan)$/;

// Pre-tax retirement money that will be taxed on the way out: converting some of it in a
// lower-bracket year costs less tax than taking it later (step 220).
const rothConversion: Detector = {
  capability: "taxes",
  topic: "roth_conversion",
  covers: ["tax_years"],
  needs: ["life_stage", "has_401k", "monthly_income", "household"],
  detect({ profile, data }) {
    const stage = profile.facts.life_stage;
    if (stage.value !== "approaching" && stage.value !== "retired") return null;
    // An inherited IRA can't be converted to a Roth: only the person's own pre-tax money counts.
    const accounts = data.accounts.filter(
      (a) =>
        a.type === "investment" &&
        PRETAX.test(a.subtype ?? "") &&
        !INHERITED_NAME.test(a.name ?? ""),
    );
    const balance = accounts.reduce((s, a) => s + a.balanceCents, 0);
    if (balance < T.rothMinBalanceCents) return null;
    const retired = stage.value === "retired";
    const status = statusOf(profile.facts.household.value);
    let convert = Math.round(balance * T.rothConvertShare);
    let nowRate: number = T.rothNowRate;
    let how: string;
    if (retired) {
      // Their income is known: convert only what fits in the bracket they're in now.
      const taxable = Math.max(0, grossIncome(profile, data) - STANDARD_DEDUCTION[status]);
      nowRate = marginalRateOf(taxable, FEDERAL_BRACKETS[status]);
      if (nowRate >= T.rothLaterRate) return null;
      const next = FEDERAL_BRACKETS[status].find((b) => b.over > taxable);
      convert = Math.min(convert, next ? next.over - taxable : convert);
      how = `Your income puts you in the ${Math.round(nowRate * 100)}% bracket now, with about ${formatCents(next ? next.over - taxable : 0)} of room before the next one. Converting ${formatCents(convert)} of your ${formatCents(balance)} in pre-tax accounts this year, instead of taking it out later at about ${Math.round(T.rothLaterRate * 100)}%, would save roughly ${formatCents(Math.round(convert * (T.rothLaterRate - nowRate)))}. Money you must withdraw this year can't be converted, so do this after that.`;
    } else {
      how = `You have ${formatCents(balance)} in pre-tax retirement accounts. In the years after you stop working and before required withdrawals begin, your income may drop into the ${Math.round(T.rothNowRate * 100)}% bracket. Converting ${formatCents(convert)} (a tenth) then, instead of withdrawing it later at about ${Math.round(T.rothLaterRate * 100)}%, would save roughly ${formatCents(Math.round(convert * (T.rothLaterRate - nowRate)))}.`;
    }
    const saves = Math.round(convert * (T.rothLaterRate - nowRate));
    if (saves <= 0) return null;
    return {
      id: suggestionId("taxes", "roth_conversion"),
      capability: "taxes",
      topic: "roth_conversion",
      title: "Look at converting some of your pre-tax retirement money to a Roth",
      worthCents: saves,
      worthKind: "saves",
      confidence: weakest([
        {
          percent: Math.min(stage.confidence, retired ? 65 : 55),
          reason: retired
            ? `${formatCents(balance)} in ${accounts.length === 1 ? "one pre-tax account" : `${accounts.length} pre-tax accounts`}; I don't know your age or other income, and later tax rates are an assumption`
            : `${formatCents(balance)} in ${accounts.length === 1 ? "one pre-tax account" : `${accounts.length} pre-tax accounts`}; when you'll stop working and your income then are assumptions`,
        },
      ]),
      urgency: month(profile.today) >= T.rothUrgentFromMonth ? "soon" : "later",
      why: how,
      action: { label: "See your tax years", href: "/taxes/years" },
    };
  },
};

// Childcare paid with after-tax money: a dependent care FSA takes it off income and payroll
// tax, worth more than the credit at most incomes (steps 169 and 122).
const childcareTaxBreak: Detector = {
  capability: "taxes",
  topic: "childcare_tax_break",
  covers: ["tax_family", "tax_savings"],
  needs: ["has_children", "monthly_income", "household"],
  detect({ profile, data }) {
    const kids = profile.facts.has_children;
    const income = profile.facts.monthly_income;
    if (kids.value !== true) return null;
    const care = tx(data, (t) => t.pfc === "GENERAL_SERVICES_CHILDCARE" && t.amountCents > 0);
    const spent = care.reduce((s, t) => s + t.amountCents, 0);
    if (spent < T.childcareMinCents) return null;
    const household = profile.facts.household.value;
    const fsa = Math.min(spent, CONTRIBUTION_LIMITS.dependentCareFsa);
    const rate = bracketOf(profile, data);
    const payroll = PAYROLL_TAX.socialSecurityRate + PAYROLL_TAX.medicareRate;
    const gross = Math.round(annual(income.value) * T.netToGross);
    const credit = Math.round(
      Math.min(spent, DEPENDENT_CARE_CREDIT.costLimit[1]) *
        careShare(gross, statusOf(household) === "married_joint"),
    );
    const saves = Math.round(fsa * (rate + payroll)) - credit;
    if (saves <= 0) return null;
    return {
      id: suggestionId("taxes", "childcare_tax_break"),
      capability: "taxes",
      topic: "childcare_tax_break",
      title: "Pay for childcare from a dependent care FSA",
      worthCents: saves,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(kids),
        factEvidence(income),
        evidence("seen", profile.months, care.length, "childcare payments"),
        {
          percent: 65,
          reason: "I can't tell whether your employer offers a dependent care FSA",
        },
      ]),
      urgency: "later",
      why: `You paid ${formatCents(spent)} for childcare in ${profile.months} months. Paying ${formatCents(fsa)} of it from a dependent care FSA skips income and payroll tax, about ${formatCents(Math.round(fsa * (rate + payroll)))}, which beats the credit's ${formatCents(credit)} at your income. This is only open if your employer offers one, and you choose the amount when you enrol.`,
      action: { label: "See family tax choices", href: "/taxes#family" },
    };
  },
};

const inIpPinSeason = (today: string) => {
  const md = today.slice(5);
  return md >= T.ipPinFrom && md <= T.ipPinUntil;
};

// From January until filing season: a PIN the IRS issues keeps anyone else from filing a
// return in the person's name (step 218). Everyone with income, once, in its season.
const identityPin: Detector = {
  capability: "taxes",
  topic: "identity_ip_pin",
  covers: ["tax_identity", "tax_calendar"],
  needs: ["income_pattern"],
  detect({ profile }) {
    const pattern = profile.facts.income_pattern;
    if (!inIpPinSeason(profile.today) || pattern.value === "unknown") return null;
    return {
      id: suggestionId("taxes", "identity_ip_pin"),
      capability: "taxes",
      topic: "identity_ip_pin",
      title: "Get an IRS Identity Protection PIN before you file",
      // The average refund times the small chance of being targeted: not the whole refund.
      worthCents: Math.round(T.typicalRefundCents * T.ipPinTheftChance),
      worthKind: "risk",
      confidence: {
        percent: Math.min((pattern as Fact).confidence, 60),
        reason: `you're paid regularly so you'll file; the figure is the average refund times a ${Math.round(T.ipPinTheftChance * 100)}% chance of being targeted`,
      },
      urgency: "soon",
      why: `Few people are ever targeted, but someone who files first with your Social Security number can take your refund (about ${formatCents(T.typicalRefundCents)} for the average filer) and it takes months to sort out. A free IP PIN from the IRS stops it, so the cost of asking is a few minutes.`,
      action: { label: "Get your IP PIN", href: "/taxes/identity" },
    };
  },
};

// November 15 to December 31: the year's last chances to cut this year's tax (steps 167 and
// 223). The one a profile can show is a workplace plan: contributions go through payroll, so
// the room left has to be used before the last paycheck. The calendar's December message carries
// the rest (losses to harvest, gifts) from the tax plan, giving and investment loaders.
const yearEndMoves: Detector = {
  capability: "taxes",
  topic: "year_end_moves",
  covers: ["tax_plan", "tax_calendar"],
  needs: ["has_401k", "monthly_income", "household"],
  detect({ profile, data }) {
    const plan = profile.facts.has_401k;
    const income = profile.facts.monthly_income;
    if (plan.value !== true || profile.today.slice(5) < T.yearEndFrom) return null;
    // Someone short of cash or in debt trouble has better uses for the money first.
    if (profile.facts.debt_trouble.value === true) return null;
    const room = Math.min(
      Math.round(CONTRIBUTION_LIMITS.workplace * T.yearEndUnusedRoomShare),
      Math.round(grossIncome(profile, data) * T.yearEndMaxIncomeShare),
    );
    const rate = bracketOf(profile, data);
    const saves = Math.round(room * rate);
    return {
      id: suggestionId("taxes", "year_end_moves"),
      capability: "taxes",
      topic: "year_end_moves",
      title: "Use your 401(k) room before your last paycheck of the year",
      worthCents: saves,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(plan),
        factEvidence(income),
        {
          percent: Math.min(plan.confidence, 50),
          reason: `I can't see what you've put in this year, so I assumed ${Math.round(T.yearEndUnusedRoomShare * 100)}% of the ${formatCents(CONTRIBUTION_LIMITS.workplace)} limit is unused`,
        },
      ]),
      urgency: profile.today.slice(5) >= "12-10" ? "now" : "soon",
      why: `Money you put into your 401(k) before December 31 is out of this year's income. About ${formatCents(room)} more, at your ${Math.round(rate * 100)}% bracket, would save roughly ${formatCents(saves)}. Payroll needs a few days, so ask HR before the last paycheck.`,
      action: { label: "See your tax plan", href: "/taxes#plan" },
    };
  },
};

// Big gifts need the charity's written receipt to be deducted (steps 168 and 171).
const charityReceipts: Detector = {
  capability: "taxes",
  topic: "charity_receipts",
  covers: ["tax_giving", "tax_records", "tax_tags"],
  needs: ["monthly_income", "household"],
  detect({ profile, data }) {
    const income = profile.facts.monthly_income;
    const gifts = tx(
      data,
      (t) =>
        t.pfc === "GOVERNMENT_AND_NON_PROFIT_DONATIONS" && t.amountCents >= GIVING.receiptFromCents,
    );
    if (gifts.length === 0) return null;
    const total = gifts.reduce((s, t) => s + t.amountCents, 0);
    const rate = bracketOf(profile, data);
    return {
      id: suggestionId("taxes", "charity_receipts"),
      capability: "taxes",
      topic: "charity_receipts",
      title: "Get the written receipt for your larger gifts",
      worthCents: Math.round(total * rate),
      worthKind: "risk",
      confidence: weakest([
        factEvidence(income),
        evidence(
          "seen",
          profile.months,
          gifts.length,
          `gifts of ${formatCents(GIVING.receiptFromCents)} or more`,
        ),
        {
          percent: 60,
          reason: "I can't see whether you already have the receipt, or whether you itemize",
        },
      ]),
      urgency: inFilingWindow(profile.today) ? "soon" : "later",
      why: `You gave ${formatCents(total)} in ${gifts.length === 1 ? "one gift" : `${gifts.length} gifts`} of ${formatCents(GIVING.receiptFromCents)} or more. If you itemize, a gift without the charity's written receipt can be disallowed, which would cost about ${formatCents(Math.round(total * rate))} at your ${Math.round(rate * 100)}% bracket.`,
      action: { label: "Check your gifts", href: "/taxes#giving" },
    };
  },
};

// Property tax is worth checking against the home's market value; the county's window is a
// deadline (steps 170 and 221). Seen from the payments to the county.
const propertyTaxCheck: Detector = {
  capability: "taxes",
  topic: "property_tax_check",
  covers: ["tax_property", "tax_home"],
  needs: ["housing"],
  detect({ profile, data }) {
    const housing = profile.facts.housing;
    if (housing.value !== "own") return null;
    const bills = tx(
      data,
      (t) =>
        t.pfc === "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" &&
        t.amountCents > 0 &&
        PROPERTY_TAX_PAYEE.test(t.description),
    );
    const paid = bills.reduce((s, t) => s + t.amountCents, 0);
    if (paid < T.propertyTaxMinCents) return null;
    const worth = Math.round(paid * APPEAL_GAP_RATE);
    return {
      id: suggestionId("taxes", "property_tax_check"),
      capability: "taxes",
      topic: "property_tax_check",
      title: "Check whether your home is assessed for more than it's worth",
      worthCents: worth,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(housing),
        evidence("seen", profile.months, bills.length, "property tax payments"),
        {
          percent: 45,
          reason: "I haven't seen your assessment, so I don't know if it's over the market value",
        },
      ]),
      urgency: "later",
      why: `You paid ${formatCents(paid)} in property tax. If your assessment is ${Math.round(APPEAL_GAP_RATE * 100)}% or more over what the home would sell for, an appeal would save about ${formatCents(worth)} a year, and the county's window to appeal is short.`,
      action: { label: "Check your property tax", href: "/taxes/property" },
    };
  },
};

// A loss in a taxable account offsets gains, then some other income (step 124). Never in a
// retirement account, where a loss isn't deductible.
const lossHarvest: Detector = {
  capability: "taxes",
  topic: "tax_loss_harvest",
  covers: ["tax_investments"],
  needs: ["monthly_income", "household"],
  detect({ profile, data }) {
    const income = profile.facts.monthly_income;
    const taxable = new Set(
      data.accounts
        .filter(
          (a) => a.type === "investment" && TAXABLE_INVESTMENT_SUBTYPES.includes(a.subtype ?? ""),
        )
        .map((a) => a.id),
    );
    const losing = (data.holdings ?? []).filter(
      (h) => taxable.has(h.accountId) && h.basisCents !== null && h.basisCents > h.valueCents,
    );
    const loss = losing.reduce((s, h) => s + (h.basisCents! - h.valueCents), 0);
    if (loss < T.harvestMinLossCents) return null;
    const offset = Math.min(loss, T.harvestOrdinaryOffsetCents);
    const rate = bracketOf(profile, data);
    const saves = Math.round(offset * rate);
    return {
      id: suggestionId("taxes", "tax_loss_harvest"),
      capability: "taxes",
      topic: "tax_loss_harvest",
      title: "Sell a holding at a loss to lower this year's tax",
      worthCents: saves,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(income),
        {
          percent: evidence("seen", profile.months, losing.length, "holdings").percent,
          reason: `${formatCents(loss)} below cost in ${losing.length === 1 ? "one holding" : `${losing.length} holdings`} in a taxable account`,
        },
        { percent: 80, reason: "the savings depend on your gains elsewhere, which I can't see" },
      ]),
      urgency: month(profile.today) >= 11 ? "soon" : "later",
      why: `A taxable account holds ${formatCents(loss)} less than you paid for it. Selling at a loss offsets gains and up to ${formatCents(T.harvestOrdinaryOffsetCents)} of other income, about ${formatCents(saves)} off your tax. Don't buy the same thing back for 30 days (the wash-sale rule).`,
      action: { label: "See your investment taxes", href: "/taxes#investments" },
    };
  },
};

const inFilingWindow = (today: string) => {
  const md = today.slice(5);
  return md >= T.filingFrom && md <= T.filingUntil;
};

// From January 15 to April 15, a return not filed: the forms are coming in and the date is
// fixed (steps 126, 166 and 223). Everyone with income.
const fileReturn: Detector = {
  capability: "taxes",
  topic: "file_return",
  covers: ["tax_return", "tax_forms"],
  needs: ["income_pattern"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    if (!inFilingWindow(profile.today) || pattern.value === "unknown") return null;
    const refund = tx(
      data,
      (t) => t.pfc === "INCOME_TAX_REFUND" && t.date > `${profile.today.slice(0, 4)}-01-01`,
    );
    if (refund.length > 0) return null;
    const year = Number(profile.today.slice(0, 4));
    const days = Math.round(
      (Date.parse(`${year}-${T.filingUntil}`) - Date.parse(profile.today)) / 86_400_000,
    );
    return {
      id: suggestionId("taxes", "file_return"),
      capability: "taxes",
      topic: "file_return",
      title: "Get your tax forms in and your return ready",
      // The penalty only applies if tax is owed, which about a fifth of filers do.
      worthCents: Math.round(T.lateFilingPenaltyCents * T.lateFilingOweShare),
      worthKind: "risk",
      confidence: {
        percent: Math.min((pattern as Fact).confidence, 60),
        reason:
          "I can't see whether you owe tax or are due a refund; the late penalty only applies if you owe",
      },
      urgency: days <= T.filingNowDays ? "now" : "soon",
      why: `Your return is due April 15, ${days} ${days === 1 ? "day" : "days"} from now. If you owe tax, filing more than 60 days late costs at least ${formatCents(T.lateFilingPenaltyCents)} (or all of it, if less); if you're due a refund there's no penalty, but it waits until you file. I collect your forms and get the return ready for you to review and sign.`,
      action: { label: "See your forms", href: "/taxes#forms" },
    };
  },
};

// A self-employed person's profit from their deposits (a freelancer's are mostly profit, a
// shop's are sales), and the tax bracket it puts them in.
const selfPaid = (pattern: unknown) => pattern === "uneven" || pattern === "business";
function profitOf(profile: { facts: Record<string, { value: unknown }> }): number {
  const share =
    profile.facts.income_pattern.value === "business"
      ? T.businessProfitShare
      : T.freelanceProfitShare;
  return Math.round(annual(profile.facts.monthly_income.value) * share);
}
function soleInput(profit: number, household: unknown, year: number): EstimateInput {
  return {
    year,
    filingStatus: statusOf(household),
    childrenUnder17: 0,
    otherDependants: 0,
    state: null,
    income: { ...NO_INCOME, selfEmploymentCents: profit },
    studentLoanInterestCents: 0,
    mortgageInterestCents: 0,
    charityCents: 0,
    medicalCents: 0,
    otherStateLocalTaxCents: 0,
    federalWithheldCents: 0,
    federalEstimatedPaidCents: 0,
    stateWithheldCents: 0,
    stateEstimatedPaidCents: 0,
  };
}
// What a deduction saves a sole proprietor: income tax at their bracket plus the 15.3% on 92.35%
// of it that self-employment tax takes.
const deductionRate = (profit: number, household: unknown) => {
  const status = statusOf(household);
  const bracket = marginalRateOf(
    Math.max(0, profit - STANDARD_DEDUCTION[status]),
    FEDERAL_BRACKETS[status],
  );
  return (
    bracket +
    (SELF_EMPLOYMENT_TAX.socialSecurityRate + SELF_EMPLOYMENT_TAX.medicareRate) *
      SELF_EMPLOYMENT_TAX.netEarningsShare
  );
};

// An S corporation saves payroll tax on what isn't paid as salary; worth raising only when that
// beats its costs and the 20% deduction lost on the salary (step 267).
const sCorpElection: Detector = {
  capability: "taxes",
  topic: "s_corp_election",
  covers: ["tax_business"],
  needs: ["income_pattern", "monthly_income", "household"],
  detect({ profile }) {
    const pattern = profile.facts.income_pattern;
    const income = profile.facts.monthly_income;
    if (!selfPaid(pattern.value)) return null;
    const profit = profitOf(profile);
    const result = structureFor(soleInput(profit, profile.facts.household.value, 2026));
    if (!result.sCorp.worthIt) return null;
    const business = pattern.value === "business";
    const md = profile.today.slice(5);
    return {
      id: suggestionId("taxes", "s_corp_election"),
      capability: "taxes",
      topic: "s_corp_election",
      title: "Ask a tax professional whether an S corporation would save you tax",
      worthCents: result.sCorp.savesCents,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(pattern),
        factEvidence(income),
        {
          percent: business ? 55 : 65,
          reason: business
            ? `your deposits are sales, so I assumed ${Math.round(T.businessProfitShare * 100)}% is profit`
            : `I assumed ${Math.round((1 - T.freelanceProfitShare) * 100)}% of what clients pay goes on costs`,
        },
      ]),
      // The election for this year is due March 15; after that it starts next year.
      urgency: md >= T.sCorpElectionFrom && md <= T.sCorpElectionBy ? "soon" : "later",
      why: `At a profit of about ${formatCents(profit)}, an S corporation (a salary of about ${formatCents(result.sCorp.salaryCents)}, the rest as profit) could cost you about ${formatCents(result.sCorp.totalCents)} in tax and costs against ${formatCents(result.sole.taxCents)} as you are: roughly ${formatCents(result.sCorp.savesCents)} less. The election (Form 2553) is due March 15 to count for the year.`,
      action: { label: "See the numbers", href: "/taxes/business" },
    };
  },
};

// Work from home with no office elsewhere: the simplified home office deduction is $5 a square
// foot up to 300 (steps 123 and 267).
const homeOffice: Detector = {
  capability: "taxes",
  topic: "home_office_deduction",
  covers: ["tax_business"],
  needs: ["income_pattern", "monthly_income", "housing"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    const income = profile.facts.monthly_income;
    if (!selfPaid(pattern.value)) return null;
    const away = tx(
      data,
      (t) =>
        t.pfc === "RENT_AND_UTILITIES_RENT" &&
        /COMMERCIAL|OFFICE|STUDIO|WORKSPACE|WEWORK/i.test(t.description),
    );
    if (away.length > 0) return null;
    // A coworking membership is an office elsewhere: a home office then needs a room used only
    // for work, which is less likely.
    const cowork = tx(
      data,
      (t) => t.amountCents > 0 && /WEWORK|COWORK|REGUS|INDUSTRIOUS/i.test(t.description),
    ).length;
    const deduction = HOME_OFFICE_ASSUMED_SQFT * HOME_OFFICE_SIMPLIFIED.perSquareFoot;
    const profit = profitOf(profile);
    const saves = Math.round(deduction * deductionRate(profit, profile.facts.household.value));
    return {
      id: suggestionId("taxes", "home_office_deduction"),
      capability: "taxes",
      topic: "home_office_deduction",
      title: "Claim a home office if you work from home",
      worthCents: saves,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(pattern),
        factEvidence(income),
        cowork > 0
          ? {
              percent: 35,
              reason:
                "you pay for a coworking space, so I can't tell if you also work from a room at home",
            }
          : {
              percent: 55,
              reason: "I can't see where you work, or whether a home office is already on file",
            },
      ]),
      urgency: "later",
      why: `You work for yourself and pay no rent for an office or studio. A room used only for work, ${HOME_OFFICE_ASSUMED_SQFT} square feet at $5 a square foot, is a ${formatCents(deduction)} deduction, which saves about ${formatCents(saves)} in income tax and self-employment tax.`,
      action: { label: "Add your home office", href: "/taxes/profile" },
    };
  },
};

// Gas for a business driver: the standard mileage rate turns logged miles into a deduction
// (steps 123 and 267).
const vehicleDeduction: Detector = {
  capability: "taxes",
  topic: "vehicle_deduction",
  covers: ["tax_business"],
  needs: ["income_pattern", "monthly_income", "has_car"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    const income = profile.facts.monthly_income;
    if (!selfPaid(pattern.value)) return null;
    const gas = tx(data, (t) => t.pfc === "TRANSPORTATION_GAS" && t.amountCents > 0);
    if (gas.length < 6) return null;
    const deduction = Math.round(VEHICLE_ASSUMED_MILES * MILEAGE_RATE_CENTS);
    const profit = profitOf(profile);
    const saves = Math.round(deduction * deductionRate(profit, profile.facts.household.value));
    return {
      id: suggestionId("taxes", "vehicle_deduction"),
      capability: "taxes",
      topic: "vehicle_deduction",
      title: "Keep a mileage log for the driving you do for your business",
      worthCents: saves,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(pattern),
        factEvidence(income),
        evidence("seen", profile.months, gas.length, "fuel purchases"),
        { percent: 45, reason: "I can't see how much of your driving is for the business" },
      ]),
      urgency: "later",
      why: `You buy gas regularly. Every business mile is a ${(MILEAGE_RATE_CENTS / 100).toFixed(3)} dollar deduction; ${VEHICLE_ASSUMED_MILES.toLocaleString("en-US")} miles, a modest year for a driver with clients, is ${formatCents(deduction)}, saving about ${formatCents(saves)}. It only counts with a log of dates, places and reasons.`,
      action: { label: "Log your miles", href: "/taxes/profile" },
    };
  },
};

// An inherited IRA has to be empty by the end of the 10th year after the owner died; taking it
// out evenly keeps each year in a lower bracket than taking it all at the end (steps 220 and
// 268). Found by the account's name; the year the owner died is something only the person can
// say.
const inheritedIra: Detector = {
  capability: "taxes",
  topic: "inherited_ira",
  covers: ["tax_inherited"],
  needs: ["inherited_ira_death_year", "inherited_from_spouse", "monthly_income", "household"],
  detect({ profile, data }) {
    const income = profile.facts.monthly_income;
    const died = profile.facts.inherited_ira_death_year;
    if (profile.facts.inherited_from_spouse.value === true) return null;
    const accounts = data.accounts.filter(
      (a) => a.type === "investment" && INHERITED_NAME.test(a.name ?? "") && a.balanceCents > 0,
    );
    if (accounts.length === 0) return null;
    const balance = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const year = Number(profile.today.slice(0, 4));
    const knownYear = typeof died.value === "number" ? died.value : null;
    const emptyBy = knownYear !== null ? mustBeEmptyBy(knownYear) : null;
    const yearsLeft = emptyBy !== null ? Math.max(1, emptyBy - year + 1) : INHERITED_IRA_YEARS;
    const status = statusOf(profile.facts.household.value);
    const base = soleInput(0, profile.facts.household.value, year);
    const spread = spreadIra({
      balanceCents: balance,
      yearsLeft,
      base: {
        ...base,
        filingStatus: status,
        income: {
          ...base.income,
          wagesCents: grossIncome(profile, data),
          socialSecurityWagesCents: grossIncome(profile, data),
        },
      },
    });
    // In the last year there is nothing left to spread: what matters is emptying it, because
    // the money not taken out by the deadline costs 25% of what is left.
    if (emptyBy !== null && yearsLeft <= 1) {
      const penalty = Math.round(balance * MISSED_WITHDRAWAL_PENALTY);
      return {
        id: suggestionId("taxes", "inherited_ira"),
        capability: "taxes",
        topic: "inherited_ira",
        title: "Take the rest of your inherited IRA out by December 31",
        worthCents: penalty,
        worthKind: "risk",
        confidence: weakest([
          factEvidence(income),
          {
            percent: 70,
            reason:
              "you told me when the owner died; whether you are an exception to the 10-year rule is unseen",
          },
        ]),
        urgency: "now",
        why: `The rule for most heirs is that your inherited IRA (${formatCents(balance)}) is empty by December 31, ${emptyBy}. Money left after that costs a penalty of 25% of what's left, up to ${formatCents(penalty)}. All of it is taxed as income the year it comes out, so a tax professional can say how much to take and when. If you are a spouse or another kind of heir the rule may not apply.`,
        action: { label: "See what applies", href: "/profile" },
      };
    }
    if (!spread.worthRaising) return null;
    return {
      id: suggestionId("taxes", "inherited_ira"),
      capability: "taxes",
      topic: "inherited_ira",
      title: "Plan how you take money out of your inherited IRA",
      worthCents: spread.savesCents,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(income),
        {
          percent: knownYear !== null ? 70 : 50,
          reason:
            knownYear !== null
              ? "you told me when the owner died; whether they had started required withdrawals and your other income later are unknown"
              : "I don't know when the owner died, so I assumed you have the full 10 years",
        },
      ]),
      urgency:
        emptyBy === null ? "later" : yearsLeft <= 1 ? "now" : yearsLeft <= 3 ? "soon" : "later",
      why: `You have ${formatCents(balance)} in an inherited IRA. ${emptyBy !== null ? `Most heirs must empty it by December 31, ${emptyBy}.` : "Most heirs must empty it within 10 years of the owner's death."} Taking about ${formatCents(spread.perYearCents)} a year instead of all at the end would save roughly ${formatCents(spread.savesCents)} in tax. A tax professional should confirm the rules that apply to you.`,
      action: { label: "Tell Jane when they died", href: "/profile" },
    };
  },
};

// A Marketplace plan's credit stops above 400% of the poverty line: an enrollee whose income
// has risen past it owes back every advance dollar (steps 269 and 123). Income is projected from
// the year's deposits, so a mid-year rise shows.
const ptcRepayment: Detector = {
  capability: "taxes",
  topic: "ptc_repayment",
  covers: ["tax_health"],
  needs: ["monthly_income", "household", "marketplace_aptc_monthly"],
  detect({ profile, data }) {
    const income = profile.facts.monthly_income;
    const aptc = profile.facts.marketplace_aptc_monthly;
    const premiums = tx(data, (t) => t.amountCents > 0 && MARKETPLACE_PAYEE.test(t.description));
    if (premiums.length < T.marketplacePaymentsMin) return null;
    const pattern = profile.facts.income_pattern.value;
    const incomeCents = selfPaid(pattern) ? profitOf(profile) : grossIncome(profile, data);
    const household = profile.facts.household.value;
    const size = household === "family" ? 3 : household === "couple" ? 2 : 1;
    const share = incomeCents / fplFor(size);
    if (share <= PTC_CLIFF) return null;
    const advance = typeof aptc.value === "number" ? aptc.value : ASSUMED_APTC_MONTHLY_CENTS;
    const month = Number(profile.today.slice(5, 7));
    return {
      id: suggestionId("taxes", "ptc_repayment"),
      capability: "taxes",
      topic: "ptc_repayment",
      title: "Your income may have passed the Marketplace credit's limit",
      worthCents: advance * 12,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(income),
        evidence("seen", profile.months, premiums.length, "Marketplace premium payments"),
        {
          percent: typeof aptc.value === "number" ? 80 : 45,
          reason:
            typeof aptc.value === "number"
              ? "you told me your advance credit; your income for the rest of the year is a projection"
              : "I can't see whether you take an advance credit or how much, so I assumed a typical one",
        },
      ]),
      urgency: month >= T.ptcNowFromMonth ? "now" : month >= T.ptcSoonFromMonth ? "soon" : "later",
      why: `You pay a Marketplace premium and your income is on track for about ${formatCents(incomeCents)}, ${Math.round(share * 100)}% of the poverty line for ${size === 1 ? "one person" : `${size} people`}, above the 400% line where the credit stops. An advance credit (${formatCents(advance)} a month is typical) would be repaid in full with your return, up to ${formatCents(advance * 12)}. Telling the Marketplace now, or lowering your income with a retirement contribution, avoids the bill.`,
      action: { label: "See the numbers", href: "/taxes/health" },
    };
  },
};

// Contributions to HSAs over the limit are taxed and carry a 6% penalty every year they stay in
// (steps 169 and 269); taking them out before filing avoids the penalty.
const hsaOverLimit: Detector = {
  capability: "taxes",
  topic: "hsa_over_limit",
  covers: ["tax_health"],
  needs: ["has_hsa", "monthly_income", "household"],
  detect({ profile, data }) {
    const hsa = profile.facts.has_hsa;
    const income = profile.facts.monthly_income;
    if (hsa.value !== true) return null;
    const ids = new Set(data.accounts.filter((a) => a.subtype === "hsa").map((a) => a.id));
    const year = profile.today.slice(0, 4);
    const puts = tx(
      data,
      (t) => ids.has(t.accountId) && t.amountCents < 0 && t.date.startsWith(year),
    );
    const contributed = puts.reduce((s, t) => s - t.amountCents, 0);
    const family = profile.facts.household.value !== "single";
    const limit = family ? CONTRIBUTION_LIMITS.hsaFamily : CONTRIBUTION_LIMITS.hsaSelf;
    const rate = bracketOf(profile, data);
    const r = hsaExcess({ contributedCents: contributed, limitCents: limit, marginalRate: rate });
    if (r.excessCents <= 0) return null;
    return {
      id: suggestionId("taxes", "hsa_over_limit"),
      capability: "taxes",
      topic: "hsa_over_limit",
      title: "Take the extra out of your HSA before you file",
      worthCents: r.exciseCents + r.taxCents,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(hsa),
        factEvidence(income),
        evidence("seen", profile.months, puts.length, "HSA deposits"),
        {
          percent: 70,
          reason: "your employer's contributions and your age (a catch-up) can change the limit",
        },
      ]),
      urgency: Number(profile.today.slice(5, 7)) <= 4 ? "now" : "soon",
      why: `You've put ${formatCents(contributed)} into your HSA this year, ${formatCents(r.excessCents)} over the ${formatCents(limit)} limit. The extra is taxed as income (about ${formatCents(r.taxCents)}) and carries a 6% penalty (${formatCents(r.exciseCents)}) every year it stays in. Taking it out, with what it earned, before you file avoids the penalty.`,
      action: { label: "See the numbers", href: "/taxes/health" },
    };
  },
};

export const TAX_DETECTORS: readonly Detector[] = [
  ptcRepayment,
  hsaOverLimit,
  inheritedIra,
  sCorpElection,
  homeOffice,
  vehicleDeduction,
  yearEndMoves,
  charityReceipts,
  propertyTaxCheck,
  lossHarvest,
  fileReturn,
  withholdingGap,
  rothConversion,
  childcareTaxBreak,
  identityPin,
];
