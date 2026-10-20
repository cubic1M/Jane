import { DETECTOR_RATES } from "@/config/detectors";
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
      worthCents: short,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(plan),
        factEvidence(income),
        {
          percent: Math.min(plan.confidence, 70),
          reason: `no vest schedule yet, so I assumed ${Math.round(T.stockVestShare * 100)}% of your ${formatCents(stock)} plan vests this year`,
        },
      ]),
      urgency: month(profile.today) >= 10 ? "soon" : "later",
      why: `Stock that vests is withheld at ${Math.round(T.rsuFlatWithholding * 100)}%, but your income puts you in the ${Math.round(rate * 100)}% bracket. On about ${formatCents(vested)} vesting, that leaves roughly ${formatCents(short)} to pay when you file.`,
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
  needs: ["life_stage", "has_401k"],
  detect({ profile, data }) {
    const stage = profile.facts.life_stage;
    if (stage.value !== "approaching" && stage.value !== "retired") return null;
    const accounts = data.accounts.filter(
      (a) => a.type === "investment" && PRETAX.test(a.subtype ?? ""),
    );
    const balance = accounts.reduce((s, a) => s + a.balanceCents, 0);
    if (balance < T.rothMinBalanceCents) return null;
    const convert = Math.round(balance * T.rothConvertShare);
    const saves = Math.round(convert * (T.rothLaterRate - T.rothNowRate));
    return {
      id: suggestionId("taxes", "roth_conversion"),
      capability: "taxes",
      topic: "roth_conversion",
      title: "Look at converting some of your pre-tax retirement money to a Roth",
      worthCents: saves,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(stage),
        evidence("seen", profile.months, accounts.length, "pre-tax retirement accounts"),
        {
          percent: Math.min(stage.confidence, 65),
          reason: `your income in the years ahead is an assumption (${Math.round(T.rothLaterRate * 100)}% later against ${Math.round(T.rothNowRate * 100)}% now)`,
        },
      ]),
      urgency: month(profile.today) >= T.rothUrgentFromMonth ? "soon" : "later",
      why: `You have ${formatCents(balance)} in pre-tax retirement accounts. Converting ${formatCents(convert)} (a tenth) in a year with room in the ${Math.round(T.rothNowRate * 100)}% bracket, instead of withdrawing it later at about ${Math.round(T.rothLaterRate * 100)}%, would save roughly ${formatCents(saves)}.`,
      action: { label: "See your tax years", href: "/taxes/years" },
    };
  },
};

// Childcare paid with after-tax money: a dependent care FSA takes it off income and payroll
// tax, worth more than the credit at most incomes (steps 169 and 122).
const childcareTaxBreak: Detector = {
  capability: "taxes",
  topic: "childcare_tax_break",
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
    const rate = marginalRate(annual(income.value), 0, household);
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
      ]),
      urgency: "later",
      why: `You paid ${formatCents(spent)} for childcare in ${profile.months} months. Paying ${formatCents(fsa)} of it from a dependent care FSA skips income and payroll tax, about ${formatCents(Math.round(fsa * (rate + payroll)))}, which beats the credit's ${formatCents(credit)} at your income. Your employer has to offer one, and you choose the amount at enrolment.`,
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
  needs: ["income_pattern"],
  detect({ profile }) {
    const pattern = profile.facts.income_pattern;
    if (!inIpPinSeason(profile.today) || pattern.value === "unknown") return null;
    return {
      id: suggestionId("taxes", "identity_ip_pin"),
      capability: "taxes",
      topic: "identity_ip_pin",
      title: "Get an IRS Identity Protection PIN before you file",
      worthCents: T.typicalRefundCents,
      worthKind: "risk",
      confidence: factEvidence(pattern as Fact),
      urgency: "soon",
      why: `Someone who files first with your Social Security number can take your refund, about ${formatCents(T.typicalRefundCents)} for the average filer. A free IP PIN from the IRS stops that.`,
      action: { label: "Get your IP PIN", href: "/taxes/identity" },
    };
  },
};

export const TAX_DETECTORS: readonly Detector[] = [
  withholdingGap,
  rothConversion,
  childcareTaxBreak,
  identityPin,
];
