import { DETECTOR_RATES } from "@/config/detectors";
import { isFilingStatus, type FilingStatus } from "@/config/tax";
import { FEDERAL_BRACKETS, SAVERS_CREDIT, STANDARD_DEDUCTION } from "@/config/tax-rates";
import { formatCents } from "@/lib/money";
import { bracketTax } from "@/planning/tax-brackets";
import { type Detector, suggestionId } from "./contract";
import { factEvidence, headlineOf, weakest } from "./helpers";

// The Saver's Credit in its last year (connectors roadmap round 17, savers_credit_2026): someone
// whose income looks to be under the limit may get at least 10% back on up to $2,000 each of IRA or
// workplace-plan money put in for 2026. Facts and the deadline only: whether to save, and where,
// is the person's. Pure; see ./contract.ts.

const statusOf = (filing: unknown, household: unknown): FilingStatus =>
  isFilingStatus(filing)
    ? filing
    : household === "couple" || household === "family"
      ? "married_joint"
      : "single";

const longDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const saversCredit: Detector = {
  capability: "taxes",
  topic: "savers_credit",
  covers: ["tax_plan"],
  needs: ["monthly_income"],
  detect({ profile }) {
    const { today, facts } = profile;
    if (today < `${SAVERS_CREDIT.taxYear}-01-01` || today > SAVERS_CREDIT.iraDeadline) return null;
    if (facts.is_student.value === true) return null;
    // Someone in debt trouble needs relief and a plan first, not a nudge to save more.
    if (facts.debt_trouble.value === true) return null;
    const monthly = facts.monthly_income.value;
    if (typeof monthly !== "number" || monthly <= 0) return null;
    // Take-home pay, grossed up like the other tax cards: a rough AGI.
    const agi = Math.round(monthly * 12 * DETECTOR_RATES.tax.netToGross);
    const status = statusOf(facts.filing_status.value, facts.household.value);
    const limit = SAVERS_CREDIT.agiLimit[status];
    if (agi > limit) return null;
    const people = status === "married_joint" ? 2 : 1;
    // The credit only lowers income tax owed (it's nonrefundable): under the standard deduction
    // there's none, so nothing to get, and a little tax caps it.
    const owed = bracketTax(
      Math.max(0, agi - STANDARD_DEDUCTION[status]),
      FEDERAL_BRACKETS[status],
    );
    const tenPercent =
      Math.round(SAVERS_CREDIT.maxContribution * SAVERS_CREDIT.lowestRate) * people;
    const least = Math.min(tenPercent, owed);
    if (least <= 0) return null;
    const cap =
      owed < tenPercent
        ? ` It can't be more than the federal income tax you owe, about ${formatCents(owed)} on this income.`
        : "";
    return {
      id: suggestionId("taxes", "savers_credit"),
      capability: "taxes",
      topic: "savers_credit",
      title: `You may qualify for the Saver's Credit on retirement money you put in for ${SAVERS_CREDIT.taxYear}`,
      headline: headlineOf("Check the Saver's Credit", least, "earns"),
      short: `Income near ${formatCents(agi)} is under its ${formatCents(limit)} limit; ${SAVERS_CREDIT.taxYear} is its last year.`,
      worthCents: least,
      worthKind: "earns",
      confidence: weakest([
        factEvidence(facts.monthly_income),
        {
          percent: 55,
          reason: "your income for the year is estimated from your pay; the credit uses your AGI",
        },
      ]),
      urgency: "later",
      why: `With ${SAVERS_CREDIT.taxYear} income near ${formatCents(agi)}, under the ${formatCents(limit)} limit for your filing status, you may qualify for the Saver's Credit (Form 8880): at least ${Math.round(SAVERS_CREDIT.lowestRate * 100)}% back on up to ${formatCents(SAVERS_CREDIT.maxContribution)}${people === 2 ? " each" : ""} of IRA or 401(k) money put in for ${SAVERS_CREDIT.taxYear}, and more at lower incomes.${cap} Workplace-plan money counts by December 31; IRA money until ${longDate(SAVERS_CREDIT.iraDeadline)}. Not for full-time students or anyone claimed as a dependent. It's the credit's last year: from 2027 the Saver's Match replaces it.`,
      action: { label: "See your tax plan", href: "/taxes" },
    };
  },
};

export const SAVERS_CREDIT_DETECTORS: readonly Detector[] = [saversCredit];
