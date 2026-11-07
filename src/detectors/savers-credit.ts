import { DETECTOR_RATES } from "@/config/detectors";
import { isFilingStatus, type FilingStatus } from "@/config/tax";
import { IRA_SUBTYPES, WORKPLACE_SUBTYPES } from "@/config/retirement-accounts";
import { SAVERS_CREDIT, SAVERS_MATCH } from "@/config/tax-rates";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { factEvidence, headlineOf, weakest } from "./helpers";

// The Saver's Credit in its last year (connectors roadmap round 17, savers_credit_2026): someone
// whose income looks to be under the limit may get at least 10% back on up to $2,000 each of IRA or
// workplace-plan money put in for 2026. Facts and the deadline only: whether to save, and where,
// is the person's. Pure; see ./contract.ts.

// Before they say how they file: a couple, or a family with two earners, files jointly; one
// earner with children is a head of household (debugger 11-06: a single parent was measured
// against the joint limit and told "$2,000 each").
const statusOf = (filing: unknown, household: unknown, earners: unknown): FilingStatus => {
  if (isFilingStatus(filing)) return filing;
  if (household === "couple") return "married_joint";
  if (household === "family")
    return typeof earners === "number" && earners >= 2 ? "married_joint" : "head_of_household";
  return "single";
};

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
    const status = statusOf(facts.filing_status.value, facts.household.value, facts.earners.value);
    const limit = SAVERS_CREDIT.agiLimit[status];
    if (agi > limit) return null;
    const people = status === "married_joint" ? 2 : 1;
    const least = Math.round(SAVERS_CREDIT.maxContribution * SAVERS_CREDIT.lowestRate) * people;
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
      why: `With ${SAVERS_CREDIT.taxYear} income near ${formatCents(agi)}, under the ${formatCents(limit)} limit for your filing status, you may qualify for the Saver's Credit (Form 8880): at least ${Math.round(SAVERS_CREDIT.lowestRate * 100)}% back on up to ${formatCents(SAVERS_CREDIT.maxContribution)}${people === 2 ? " each" : ""} of IRA or 401(k) money put in for ${SAVERS_CREDIT.taxYear}, and more at lower incomes. Workplace-plan money counts by December 31; IRA money until ${longDate(SAVERS_CREDIT.iraDeadline)}. Not for full-time students or anyone claimed as a dependent. It's the credit's last year: from 2027 the Saver's Match replaces it.`,
      action: { label: "See your tax plan", href: "/taxes" },
    };
  },
};

// The Saver's Match from 2027 (round 17, savers_match_ready_2027): someone whose income looks to be
// in range hears that the match only lands in a traditional IRA or a plan that accepts it, never a
// Roth IRA, and which of their linked accounts could take it. Labelled proposed.
const saversMatch: Detector = {
  capability: "taxes",
  topic: "savers_match",
  covers: ["tax_plan"],
  needs: ["monthly_income"],
  detect({ profile, data }) {
    const { today, facts } = profile;
    if (today < SAVERS_MATCH.shownFrom || today > SAVERS_MATCH.shownUntil) return null;
    if (facts.is_student.value === true || facts.debt_trouble.value === true) return null;
    const monthly = facts.monthly_income.value;
    if (typeof monthly !== "number" || monthly <= 0) return null;
    const agi = Math.round(monthly * 12 * DETECTOR_RATES.tax.netToGross);
    const status = statusOf(facts.filing_status.value, facts.household.value, facts.earners.value);
    const [from, to] = SAVERS_MATCH.phaseOut[status];
    if (agi >= to) return null;
    const people = status === "married_joint" ? 2 : 1;
    const share = agi <= from ? 1 : (to - agi) / (to - from);
    const match = Math.round(SAVERS_MATCH.maxContribution * SAVERS_MATCH.rate * share) * people;
    if (match <= 0) return null;
    const subtypes = data.accounts.map((a) => (a.subtype ?? "").toLowerCase());
    const has = (list: readonly string[]) => subtypes.some((s) => list.includes(s));
    const lines = [
      has(["roth"]) ? "a Roth IRA (it can't take the match)" : null,
      has(IRA_SUBTYPES.filter((s) => s !== "roth"))
        ? "a traditional IRA (if the provider accepts it)"
        : null,
      has(WORKPLACE_SUBTYPES) ? "a workplace plan (if the plan opts in)" : null,
    ].filter((l): l is string => l !== null);
    return {
      id: suggestionId("taxes", "savers_match"),
      capability: "taxes",
      topic: "savers_match",
      title: `From ${SAVERS_MATCH.firstYear}, a federal match on retirement saving may apply to you (proposed rules)`,
      headline: headlineOf("Check the 2027 Saver's Match", match, "earns"),
      short: `Proposed: up to ${formatCents(match)} a year, paid only into a traditional IRA or a plan, not a Roth IRA.`,
      worthCents: match,
      worthKind: "earns",
      confidence: weakest([
        factEvidence(facts.monthly_income),
        {
          percent: 45,
          reason: "the rules are proposed, and your income is estimated from your pay",
        },
      ]),
      urgency: "later",
      why: `Under proposed rules (${SAVERS_MATCH.rule}), from ${SAVERS_MATCH.firstYear} the federal government matches ${Math.round(SAVERS_MATCH.rate * 100)}% of up to ${formatCents(SAVERS_MATCH.maxContribution)}${people === 2 ? " each" : ""} of retirement saving, less as income rises from ${formatCents(from)} to ${formatCents(to)}. With income near ${formatCents(agi)}, that's up to ${formatCents(match)} a year. The match is paid only into a traditional IRA or a workplace plan that accepts it, never into a Roth IRA. ${lines.length ? `Your linked retirement accounts: ${lines.join("; ")}.` : "No retirement account is linked."} The IRS sends a CP321J letter to people who may qualify; it's real, not a bill.`,
      action: { label: "See your tax plan", href: "/taxes" },
    };
  },
};

export const SAVERS_CREDIT_DETECTORS: readonly Detector[] = [saversCredit, saversMatch];
