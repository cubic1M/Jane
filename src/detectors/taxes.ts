import { DETECTOR_RATES } from "@/config/detectors";
import { GIVING } from "@/config/giving";
import { PROPERTY_TAX_PAYEE } from "@/config/home-taxes";
import { APPEAL_GAP_RATE } from "@/config/property-tax";
import { TAXABLE_INVESTMENT_SUBTYPES } from "@/config/tax";
import { ESTIMATED_TAX_DATES } from "@/config/tax-pack";
import {
  CONTRIBUTION_LIMITS,
  DEPENDENT_CARE_CREDIT,
  FEDERAL_BRACKETS,
  PAYROLL_TAX,
  STANDARD_DEDUCTION,
} from "@/config/tax-rates";
import { formatCents } from "@/lib/money";
import { marginalRateOf } from "@/planning/tax-estimate";
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
    const accounts = data.accounts.filter(
      (a) => a.type === "investment" && PRETAX.test(a.subtype ?? ""),
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

export const TAX_DETECTORS: readonly Detector[] = [
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
