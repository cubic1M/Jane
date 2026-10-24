import { DETECTOR_RATES } from "@/config/detectors";
import { HOME_OFFICE_ASSUMED_SQFT, VEHICLE_ASSUMED_MILES } from "@/config/business-structure";
import { GIVING } from "@/config/giving";
import { MEDICAL_MIN_SAVING_CENTS, PTC_MIN_REPAY_CENTS } from "@/config/health-taxes";
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
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { structureFor } from "@/planning/business-structure";
import { readHealthTaxes } from "@/planning/health-taxes-read";
import { readRetirementTaxes } from "@/planning/retirement-taxes-read";
import { IRMAA_WATCH, SS_TAX_MIN_CENTS } from "@/config/retirement-taxes";
import { casualtyLoss, computedMoves, damageSince, reliefFor } from "@/planning/disasters";
import { mustBeEmptyBy, spreadIra } from "@/planning/inheritance";
import { NO_INCOME, marginalRateOf, type EstimateInput } from "@/planning/tax-estimate";
import { careShare } from "@/planning/tax-savings";
import type { Fact } from "@/profile/build";
import { type Detector, type Urgency, suggestionId } from "./contract";
import { evidence, factEvidence, tx, weakest, headlineOf } from "./helpers";

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
    // The person's figure, worked out by the same code as the chat's answer (their vests this
    // year, or an assumed share of the plan when none are known); the sample people's is
    // estimated here.
    const given = data.extras?.rsuGap;
    if (given !== undefined && (given === null || given.shortfallCents <= 0)) return null;
    const vested = given ? given.vestedCents : Math.round(stock * T.stockVestShare);
    const rate = given
      ? given.marginalRate
      : marginalRate(annual(income.value), vested, profile.facts.household.value);
    if (!given && rate <= T.rsuFlatWithholding + 0.005) return null;
    const short = given ? given.shortfallCents : Math.round(vested * (rate - T.rsuFlatWithholding));
    const assumed = !given || given.assumed;
    return {
      id: suggestionId("taxes", "withholding_gap"),
      capability: "taxes",
      topic: "withholding_gap",
      title: "Set aside the tax your stock vests won't have withheld",
      headline: headlineOf("Set aside tax on stock vests", short, "risk"),
      short:
        `${assumed ? "About" : ""} ${formatCents(vested)} is vesting, and flat withholding leaves you short.`.trim(),
      // The bill itself can't be saved; planning for it avoids the penalty and the surprise,
      // so it counts for a share of its size in ranking.
      worthCents: short,
      worthKind: "risk",
      rankCents: Math.round(short * T.rankShareOfBill),
      confidence: weakest([
        factEvidence(plan),
        factEvidence(income),
        assumed
          ? {
              percent: Math.min(plan.confidence, 70),
              reason: `no vest schedule yet, so I assumed ${Math.round(T.stockVestShare * 100)}% of your ${formatCents(stock)} plan vests this year`,
            }
          : { percent: 90, reason: "your vests this year and your tax bracket" },
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
      // Spec step 271: on Social Security, each converted dollar can make up to 85 cents more of it
      // taxable, so the real rate on the conversion is higher than the bracket.
      nowRate = Math.max(nowRate, readRetirementTaxes(profile, data).nextDollarRate);
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
      headline: headlineOf("Convert some pre-tax money to Roth", saves, "saves"),
      short: `Done well, it could save about ${formatCents(saves)} a year in tax.`,
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
      headline: headlineOf("Use a dependent care FSA", saves, "saves"),
      short: `You paid ${formatCents(spent)} for childcare in ${profile.months} months.`,
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
      headline: headlineOf(
        "Get an IRS Identity Protection PIN",
        Math.round(T.typicalRefundCents * T.ipPinTheftChance),
        "risk",
      ),
      short: `A stolen refund averages ${formatCents(T.typicalRefundCents)}; a free IP PIN stops it.`,
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
      headline: headlineOf("Add to your 401(k) before year end", saves, "saves"),
      short: `About ${formatCents(room)} more at your ${Math.round(rate * 100)}% bracket would save ${formatCents(saves)}.`,
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
      headline: headlineOf("Get receipts for your larger gifts", Math.round(total * rate), "risk"),
      short: `You gave ${formatCents(total)} in gifts of ${formatCents(GIVING.receiptFromCents)} or more.`,
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
      headline: headlineOf("Check your home's tax assessment", worth, "saves"),
      short: `You paid ${formatCents(paid)} in property tax.`,
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
      headline: headlineOf("Sell a holding at a loss", saves, "saves"),
      short: `A taxable account holds ${formatCents(loss)} less than you paid for it.`,
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
      headline: headlineOf(
        "Get your tax forms in",
        Math.round(T.lateFilingPenaltyCents * T.lateFilingOweShare),
        "risk",
      ),
      short: `Your return is due April 15, ${days} ${days === 1 ? "day" : "days"} from now.`,
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
      headline: headlineOf("Ask about an S corporation", result.sCorp.savesCents, "saves"),
      short: `At about ${formatCents(profit)} profit, a salary plus distributions could cut your tax.`,
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
    const deduction = HOME_OFFICE_ASSUMED_SQFT * HOME_OFFICE_SIMPLIFIED.perSquareFoot;
    const profit = profitOf(profile);
    const saves = Math.round(deduction * deductionRate(profit, profile.facts.household.value));
    return {
      id: suggestionId("taxes", "home_office_deduction"),
      capability: "taxes",
      topic: "home_office_deduction",
      title: "Claim a home office if you work from home",
      headline: headlineOf("Claim a home office", saves, "saves"),
      short: `${HOME_OFFICE_ASSUMED_SQFT} square feet used only for work is a ${formatCents(deduction)} deduction.`,
      worthCents: saves,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(pattern),
        factEvidence(income),
        {
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
      headline: headlineOf("Keep a mileage log", saves, "saves"),
      short: `You bought gas ${gas.length} times; ${VEHICLE_ASSUMED_MILES.toLocaleString("en-US")} business miles is a ${formatCents(deduction)} deduction.`,
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
// say. Two detectors read it: the deadline in the last year (a fact, for everyone) and spreading
// the withdrawals before then (a recommendation, demo advice only; taxes QA, 2026-10-22).
function inheritedIraOf({ profile, data }: Parameters<Detector["detect"]>[0]) {
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
  return { income, balance, knownYear, emptyBy, yearsLeft, spread };
}

const INHERITED_NEEDS: Detector["needs"] = [
  "inherited_ira_death_year",
  "inherited_from_spouse",
  "monthly_income",
  "household",
];

const inheritedIra: Detector = {
  capability: "taxes",
  topic: "inherited_ira",
  covers: ["tax_inherited"],
  needs: INHERITED_NEEDS,
  detect(input) {
    const ira = inheritedIraOf(input);
    if (!ira) return null;
    const { income, balance, emptyBy, yearsLeft } = ira;
    // In the last year there is nothing left to spread: what matters is emptying it, because
    // the money not taken out by the deadline costs 25% of what is left.
    if (emptyBy !== null && yearsLeft <= 1) {
      const penalty = Math.round(balance * MISSED_WITHDRAWAL_PENALTY);
      return {
        id: suggestionId("taxes", "inherited_ira"),
        capability: "taxes",
        topic: "inherited_ira",
        title: "Take the rest of your inherited IRA out by December 31",
        headline: headlineOf("Empty your inherited IRA this year", penalty, "risk"),
        short: `Your inherited IRA holds ${formatCents(balance)}; what's left after ${emptyBy} costs 25%.`,
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
    return null;
  },
};

const inheritedIraSpread: Detector = {
  capability: "taxes",
  topic: "inherited_ira_spread",
  covers: ["tax_inherited"],
  needs: INHERITED_NEEDS,
  detect(input) {
    const ira = inheritedIraOf(input);
    if (!ira) return null;
    const { income, balance, knownYear, emptyBy, yearsLeft, spread } = ira;
    // The last year is the deadline's (inheritedIra): nothing is left to spread.
    if (emptyBy !== null && yearsLeft <= 1) return null;
    if (!spread.worthRaising) return null;
    return {
      id: suggestionId("taxes", "inherited_ira_spread"),
      capability: "taxes",
      topic: "inherited_ira_spread",
      title: "Plan how you take money out of your inherited IRA",
      headline: headlineOf("Spread your inherited IRA withdrawals", spread.savesCents, "saves"),
      short: `About ${formatCents(spread.perYearCents)} a year from your ${formatCents(balance)} inherited IRA keeps brackets low.`,
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

// The Marketplace credit (step 269): the advance credit is set from the income a person expected
// when they enrolled; a rise later in the year means some or all of it comes back as a bill with
// the return (from 2026 with no cap). The income is read month by month, so a mid-year rise shows.
const ptcRepayment: Detector = {
  capability: "taxes",
  topic: "ptc_repayment",
  covers: ["tax_health"],
  needs: ["income_pattern", "monthly_income", "household", "marketplace_aptc_monthly"],
  detect({ profile, data }) {
    const h = readHealthTaxes(profile, data);
    const c = h.marketplace.check;
    if (!c || c.repayCents < PTC_MIN_REPAY_CENTS) return null;
    const m = month(profile.today);
    const pct = Math.round(c.fplShare * 100);
    const size = h.householdSize;
    return {
      id: suggestionId("taxes", "ptc_repayment"),
      capability: "taxes",
      topic: "ptc_repayment",
      title: "Tell the Marketplace your income has gone up, so the credit isn't a bill in April",
      headline: headlineOf("Tell the Marketplace your new income", c.repayCents, "risk"),
      short: `Your income is on pace for ${formatCents(h.pace.projectedCents)}, ${pct}% of the poverty line.`,
      worthCents: c.repayCents,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(profile.facts.income_pattern),
        factEvidence(profile.facts.monthly_income),
        evidence("seen", profile.months, h.marketplace.payments, "Marketplace premium payments"),
        h.marketplace.told
          ? {
              percent: 75,
              reason:
                "you told me your advance credit; the rest of the year's income is a projection",
            }
          : {
              percent: 50,
              reason:
                "I can't see your advance credit, so I took it from your income in the year's first months",
            },
      ]),
      urgency: m >= T.ptcNowFromMonth ? "now" : m >= T.ptcSoonFromMonth ? "soon" : "later",
      why: `You pay a Marketplace premium, and your income has gone up: about ${formatCents(Math.round(h.pace.enrollmentCents / 12))} a month early in the year, about ${formatCents(h.pace.recentMonthlyCents)} a month lately. At about ${formatCents(h.pace.projectedCents)} for the year (${pct}% of the poverty line for ${size === 1 ? "one person" : `${size} people`})${c.overCliff ? ", over the 400% line where the credit stops," : ""} the credit you're allowed is ${formatCents(c.allowedCents)} against about ${formatCents(c.advanceCents)} paid in advance, so about ${formatCents(c.repayCents)} would come back with your return, with no cap from 2026. Updating your income on the Marketplace now lowers the advance for the rest of the year.`,
      action: { label: "See the numbers", href: "/taxes/health" },
    };
  },
};

// HSA deposits over the year's limit aren't deductible and carry a 6% penalty each year they stay
// in (steps 159 and 269); the pace to December shows it before it happens.
const hsaOverLimit: Detector = {
  capability: "taxes",
  topic: "hsa_over_limit",
  covers: ["tax_health"],
  needs: ["has_hsa", "household", "age"],
  detect({ profile, data }) {
    const fact = profile.facts.has_hsa;
    if (fact.value !== true) return null;
    const h = readHealthTaxes(profile, data).hsa;
    if (h.deposits === 0 || h.projectedExcessCents <= 0) return null;
    const over = h.excessCents > 0;
    const cover = h.family ? "family" : "self-only";
    return {
      id: suggestionId("taxes", "hsa_over_limit"),
      capability: "taxes",
      topic: "hsa_over_limit",
      title: over
        ? "Stop your HSA deposits and take the extra out before you file"
        : "Lower your HSA deposits so they stay under the limit",
      headline: headlineOf(
        over ? "Stop your HSA deposits" : "Lower your HSA deposits",
        h.exciseCents,
        "risk",
      ),
      short: `${formatCents(h.contributedCents)} in so far this year; the ${cover} limit is ${formatCents(h.limitCents)}.`,
      worthCents: h.exciseCents,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(fact),
        evidence("seen", profile.months, h.deposits, "HSA deposits"),
        {
          percent: 70,
          reason: `I took your cover as ${cover} from your household, and an employer's deposits I can't see add to the total`,
        },
      ]),
      urgency: over ? "now" : "soon",
      why: `You've put ${formatCents(h.contributedCents)} into your HSA this year, and at this pace about ${formatCents(h.projectedCents)} by December, against a ${formatCents(h.limitCents)} limit for ${cover} cover. ${over ? `${formatCents(h.excessCents)} is over already.` : `That would be ${formatCents(h.projectedExcessCents)} over.`} Money over the limit isn't deductible and costs a 6% penalty (about ${formatCents(h.exciseCents)}) every year it stays in. Taking it out, with what it earned, before you file avoids the penalty; your HSA provider has a form for it.`,
      action: { label: "See the numbers", href: "/taxes/health" },
    };
  },
};

// Medical costs count only above 7.5% of income and only when itemizing beats the standard
// deduction (step 269, from the medical spending step 200 reads); a big year of care can tip it.
const medicalDeductionDetector: Detector = {
  capability: "taxes",
  topic: "medical_deduction",
  covers: ["tax_health"],
  needs: ["monthly_income", "household", "life_stage"],
  detect({ profile, data }) {
    const h = readHealthTaxes(profile, data).medical;
    if (h.spentCents <= 0 || h.savesCents < MEDICAL_MIN_SAVING_CENTS) return null;
    return {
      id: suggestionId("taxes", "medical_deduction"),
      capability: "taxes",
      topic: "medical_deduction",
      title: "Keep your medical receipts: this year they're worth itemizing",
      headline: headlineOf("Keep your medical receipts", h.savesCents, "saves", true),
      short: `You paid ${formatCents(h.spentCents)} for care this year; ${formatCents(h.floorCents)} is the 7.5% floor.`,
      worthCents: h.savesCents,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(profile.facts.monthly_income),
        evidence("seen", profile.months, h.payments, "medical payments"),
        {
          percent: 60,
          reason:
            "insurance may still pay some of these bills, and I estimated your income for the 7.5% floor",
        },
      ]),
      urgency: month(profile.today) >= 11 ? "soon" : "later",
      why: `You've paid ${formatCents(h.spentCents)} for care and health premiums this year. Only what's over 7.5% of your income (about ${formatCents(h.floorCents)}) counts, which is ${formatCents(h.deductibleCents)}; with your property tax and gifts that's more than your ${formatCents(h.standardCents)} standard deduction, so itemizing would save about ${formatCents(h.savesCents)}. Keep the bills and receipts, and ask whoever does your return to itemize.`,
      action: { label: "See the numbers", href: "/taxes/health" },
    };
  },
};

// Disaster relief (step 270): a postponement declared for the person's county moves their
// federal tax deadlines; repairs since, less what insurance paid back, may be a casualty loss.
// Only from the person's disaster feed (the stand-in's samples for demo-bank people).
const longDate = (day: string) => dayLabel(day, { year: true });
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const disasterRelief: Detector = {
  capability: "taxes",
  topic: "disaster_relief",
  covers: ["tax_disaster"],
  needs: ["county", "monthly_income", "household"],
  detect({ profile, data }) {
    const county = profile.facts.county;
    if (typeof county.value !== "string") return null;
    const r = reliefFor(
      data.extras?.disasterRelief ?? [],
      { county: county.value, state: null },
      profile.today,
    )[0];
    if (!r) return null;
    const damage = damageSince(data.transactions, r.incidentFrom);
    const loss = casualtyLoss({
      repairsCents: damage.repairsCents,
      reimbursedCents: damage.reimbursedCents,
      agiCents: grossIncome(profile, data),
      relief: r,
    });
    const saves = Math.round(loss.deductibleCents * bracketOf(profile, data));
    const year = Number(profile.today.slice(0, 4));
    const moved = computedMoves(r, [year - 1, year, year + 1]).filter(
      (m) => m.from >= profile.today,
    );
    const to = longDate(r.postponedTo);
    return {
      id: suggestionId("taxes", "disaster_relief"),
      capability: "taxes",
      topic: "disaster_relief",
      title: `Use the IRS disaster postponement for ${county.value} County: your tax deadlines move to ${to}`,
      headline: headlineOf(
        `Check your ${county.value} County disaster relief`,
        saves,
        "saves",
        true,
      ),
      short: `${moved.length} federal tax date${moved.length === 1 ? "" : "s"} move to ${to}; repairs seen: ${formatCents(damage.repairsCents)}.`,
      worthCents: saves,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(county),
        {
          percent: 70,
          reason:
            "I matched your county by name from your property tax; tell me your state to be sure",
        },
        ...(saves > 0
          ? [
              {
                percent: 55,
                reason: "I can't see whether you itemize or what insurance may still pay",
              },
            ]
          : []),
      ]),
      urgency: moved.some((m) => daysBetween(profile.today, m.from) <= 45) ? "now" : "soon",
      why: `The IRS has postponed federal tax deadlines for ${county.value} County after ${r.title.replace(/ \(sample declaration\)$/, "").toLowerCase()} from ${longDate(r.incidentFrom)}: ${moved.map((m) => `${m.title} (${longDate(m.from)})`).join("; ")} move${moved.length === 1 ? "s" : ""} to ${to}. ${
        damage.repairsCents > 0
          ? `You've paid ${formatCents(damage.repairsCents)} for repairs since, and ${formatCents(damage.reimbursedCents)} came back from insurance or assistance, so the loss is ${formatCents(loss.lossCents)}. ${
              loss.deductibleCents > 0
                ? `After the $100 and 10%-of-income floors, ${formatCents(loss.deductibleCents)} is deductible if you itemize, worth up to about ${formatCents(saves)}; keep the bills with your insurance claim, since what insurance pays changes it.`
                : "After the $100 and 10%-of-income floors none of it is deductible; keep the bills with your insurance claim, since what insurance pays changes the loss."
            }`
          : "If the disaster damaged your home or car, keep the repair bills and the insurance claim together."
      }${r.sample ? " (This is a sample declaration from Jane's stand-in feed.)" : ""}`,
      action: { label: "Move my tax deadlines", href: "/deadlines" },
    };
  },
};

// Social Security is partly taxed once other income passes a line, and nothing is withheld from
// it unless the person asks (Form W-4V): a bill at filing (step 271). Each extra pre-tax dollar
// can make up to 85 cents more of it taxable, so the next dollar costs more than the bracket says.
const socialSecurityTaxDetector: Detector = {
  capability: "taxes",
  topic: "social_security_tax",
  covers: ["tax_retirement"],
  needs: ["income_pattern", "household"],
  detect({ profile, data }) {
    const r = readRetirementTaxes(profile, data);
    if (r.ssDeposits < 3 || r.ss.taxableCents <= 0) return null;
    const tax = Math.round(r.ss.taxableCents * r.bracket);
    if (tax < SS_TAX_MIN_CENTS) return null;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    return {
      id: suggestionId("taxes", "social_security_tax"),
      capability: "taxes",
      topic: "social_security_tax",
      title: "Have tax withheld from your Social Security, so the part that's taxed isn't a bill",
      headline: headlineOf("Set up withholding on Social Security", tax, "risk"),
      short: `${formatCents(r.ss.taxableCents)} of your ${formatCents(r.ssBenefitsCents)} Social Security is taxable.`,
      worthCents: tax,
      worthKind: "risk",
      confidence: weakest([
        evidence("seen", profile.months, r.ssDeposits, "Social Security deposits"),
        { percent: 55, reason: "I can't see whether tax is already withheld from it" },
      ]),
      urgency: month(profile.today) >= 10 ? "soon" : "later",
      why: `Your Social Security is ${formatCents(r.ssBenefitsCents)} a year and your other income about ${formatCents(r.otherIncomeCents)}, so ${formatCents(r.ss.taxableCents)} of it is taxable: about ${formatCents(tax)} of tax at your ${pct(r.bracket)} bracket, which nothing withholds unless you ask (Form W-4V lets Social Security withhold 7%, 10%, 12% or 22%). ${
        r.ss.extraTaxablePerDollar > 0
          ? `And each extra dollar from your IRA makes ${Math.round(r.ss.extraTaxablePerDollar * 100)} cents more of it taxable, so your next IRA dollar is taxed at about ${pct(r.nextDollarRate)}, not ${pct(r.bracket)}.`
          : ""
      }`.trim(),
      action: { label: "See the numbers", href: "/taxes" },
    };
  },
};

// Medicare's income surcharge (IRMAA) is set by income two years before (step 271): near or on
// Medicare, with pre-tax savings that withdrawals or conversions could push past the line.
const irmaaWatch: Detector = {
  capability: "taxes",
  topic: "irmaa_watch",
  covers: ["tax_retirement"],
  needs: ["life_stage", "household", "monthly_income"],
  detect({ profile, data }) {
    const r = readRetirementTaxes(profile, data);
    if (!r.nearMedicare || r.balances.preTaxCents < IRMAA_WATCH.minPreTaxCents) return null;
    const room = r.irmaa.roomCents;
    if (room === null || r.irmaa.nextLineCents === null || r.irmaa.nextYearlyCents === null)
      return null;
    if (r.irmaa.tier === 0 && room > r.balances.preTaxCents * IRMAA_WATCH.roomShare) return null;
    const couple = r.people === 2;
    return {
      id: suggestionId("taxes", "irmaa_watch"),
      capability: "taxes",
      topic: "irmaa_watch",
      title: `Keep this year's income under ${formatCents(r.irmaa.nextLineCents)}, Medicare's surcharge line for ${r.irmaa.premiumYear}`,
      headline: headlineOf(
        "Keep withdrawals under Medicare's line",
        r.irmaa.nextYearlyCents,
        "risk",
      ),
      short: `Your income is about ${formatCents(r.magiCents)}; ${formatCents(room)} more crosses the ${r.irmaa.premiumYear} line.`,
      worthCents: r.irmaa.nextYearlyCents,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(profile.facts.monthly_income),
        {
          percent: typeof profile.facts.age.value === "number" ? 70 : 50,
          reason:
            typeof profile.facts.age.value === "number"
              ? "the line two years ahead is estimated from this year's"
              : "I don't know your age, so I can't tell whether you'll be on Medicare then",
        },
      ]),
      urgency: month(profile.today) >= 10 ? "soon" : "later",
      why: `Medicare premiums in ${r.irmaa.premiumYear} are set by this year's income. Yours is about ${formatCents(r.magiCents)}${couple ? " for the two of you" : ""}; ${formatCents(r.irmaa.nextLineCents)} is the next surcharge line${r.irmaa.estimated ? " (estimated)" : ""}, ${formatCents(room)} away. With ${formatCents(r.balances.preTaxCents)} in pre-tax accounts, a Roth conversion or a big withdrawal over that would add about ${formatCents(r.irmaa.nextYearlyCents)} a year to ${couple ? "your Part B and D premiums together" : "your Part B and D premiums"}. Taking the rest from taxable accounts, then Roth, stays under it.`,
      action: { label: "See my retirement paycheck", href: "/investments/retirement-income" },
    };
  },
};

// A draft return checked before filing (step 272): what the check found, each with the tax it
// changes. Raised as soon as a confirmed draft has something to fix: before the person files.
const draftReturnCheck: Detector = {
  capability: "taxes",
  topic: "draft_return_check",
  covers: ["tax_draft_check"],
  needs: [],
  detect({ data }) {
    const d = data.extras?.draftReturn;
    if (!d || d.findings.length === 0) return null;
    const total = d.findings.reduce((s, f) => s + f.dollarsCents, 0);
    const owes = d.findings.some((f) => f.effect === "owes");
    const top = d.findings[0];
    return {
      id: suggestionId("taxes", "draft_return_check"),
      capability: "taxes",
      topic: "draft_return_check",
      title: `Fix ${d.findings.length === 1 ? "one thing" : `${d.findings.length} things`} in your ${d.year} draft return before you file`,
      headline: headlineOf("Fix your draft return", total, owes ? "risk" : "saves", true),
      short: `${top.title}, on ${top.line}: ${formatCents(top.dollarsCents)}.`,
      worthCents: total,
      worthKind: owes ? "risk" : "saves",
      confidence: {
        percent: 80,
        reason:
          "you confirmed what I read, and each line is checked against your forms and accounts",
      },
      urgency: "now",
      why: `I checked your ${d.year} draft against your forms and accounts. ${d.findings
        .map(
          (f) =>
            `${f.title} (${f.line}): about ${formatCents(f.dollarsCents)} ${f.effect === "saves" ? "back" : "more tax"}.`,
        )
        .join(
          " ",
        )} Fix them in your software or with your preparer before you file; I don't file it.`,
      action: { label: "See every line", href: "/taxes/draft" },
    };
  },
};

export const TAX_DETECTORS: readonly Detector[] = [
  draftReturnCheck,
  socialSecurityTaxDetector,
  irmaaWatch,
  disasterRelief,
  ptcRepayment,
  hsaOverLimit,
  medicalDeductionDetector,
  inheritedIra,
  inheritedIraSpread,
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
