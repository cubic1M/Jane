import { DETECTOR_RATES } from "@/config/detectors";
import { ESTIMATED_TAX, SIDE_INCOME, SOURCES } from "@/config/student-taxes";
import { TAX_SET_ASIDE } from "@/config/tax-set-aside";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { sumCents } from "@/planning/student-money";
import {
  dependentOf,
  federalTaxOf,
  filingStatusOf,
  marginalRateFor,
  onStudentVisa,
  studentYearOf,
  yearCoverageMonths,
} from "@/planning/student-tax";
import { selfEmploymentTax } from "@/planning/tax-estimate";
import { rateMonthsOf, type ProfileTx } from "@/profile/build";
import { type Detector, type Suggestion, suggestion } from "./contract";
import { clip, evidence, factEvidence, headlineOf, nice, weakest } from "./helpers";
import { datesLine, penaltyRule } from "./student-taxes";
import { urgencyForEstimated } from "./taxes";

// Side income beside a paycheck (suggest-taxes phase 2, the gap pass: the walk's checking-only person
// is paid by an employer and also takes Stripe payouts and Venmo cash-outs, and Jane said nothing about
// tax on them). Nothing is withheld from it; self-employment tax applies from $400 of net earnings, and
// it's income whether or not a 1099-K comes. Money cashed out of a payment app may be friends paying
// back, which isn't income: only the person can say (app_income). Facts; pure.

const PLATFORM = new Set(["INCOME_CONTRACTOR", "INCOME_GIG_ECONOMY"]);

// Whether estimated payments are required turns on what the whole return owes at filing, which
// this card can't see (a paycheck's withholding may cover this, or fall short of it): under the
// floor it says that, and not "nothing is required".
const estimatedRule = (owedLastYear: unknown, taxCents: number): string =>
  owedLastYear !== "no" && taxCents < ESTIMATED_TAX.requiredFromCents
    ? `Whether estimated payments are required depends on what your whole ${ESTIMATED_TAX.taxYear} return owes at filing, with your paycheck's withholding counted (Pub. 505).`
    : penaltyRule(owedLastYear, false, taxCents);

const sideIncomeTax: Detector = {
  capability: "taxes",
  topic: "side_income_tax",
  covers: ["tax_self_employed"],
  needs: ["app_income"],
  detect({ profile, data }): Suggestion | null {
    const { facts } = profile;
    if (onStudentVisa(facts)) return null;
    // The tax engine's own card already counts it (a real account's tax_not_yet_paid).
    if (data.extras?.taxSetAside?.status === "needed") return null;
    const year = Number(profile.today.slice(0, 4));
    const thisYear = (t: ProfileTx) => t.date.startsWith(`${year}-`) && t.date <= profile.today;
    const wages = data.transactions.filter(
      (t) =>
        thisYear(t) && t.amountCents < 0 && (t.pfc === "INCOME_SALARY" || t.pfc === "INCOME_WAGES"),
    );
    // Beside a paycheck: someone paid only this way is self-employed, which the other cards cover.
    if (wages.length === 0) return null;
    const platform = data.transactions.filter(
      (t) => thisYear(t) && t.amountCents < 0 && PLATFORM.has(t.pfc ?? ""),
    );
    const apps = data.transactions.filter(
      (t) =>
        thisYear(t) &&
        t.amountCents < 0 &&
        !PLATFORM.has(t.pfc ?? "") &&
        SIDE_INCOME.appWords.test(t.description.toUpperCase()),
    );
    const said = facts.app_income.value;
    // Only app cash-outs the person confirmed are work count; "mixed" holds friends' repayments
    // too and the work share isn't known, so it stays out of the figure (and is said so).
    const counted = [...platform, ...(said === "work" ? apps : [])];
    if (counted.length === 0) return null;
    // This year's payouts, paced over the months of this year the data covers: twelve months of
    // history ending June 30 hold six months of this year's pay, not twelve.
    const months = yearCoverageMonths(data, rateMonthsOf(profile));
    const seen = sumCents(counted);
    const pace = Math.round((seen * 12) / months);
    const yearOf = studentYearOf(data, facts, months);
    const wagesYear = yearOf.wagesCents;
    // A fellowship's stipend is taxable income that uses the standard deduction first; it is not
    // wages (no Social Security tax) and the side payouts are not in it (CodeRabbit sweep 1c, #2270).
    const baseIncome = wagesYear + yearOf.stipendCents;
    const status = filingStatusOf(facts);
    const se = selfEmploymentTax(pace, wagesYear);
    const dependent = dependentOf(facts) === "yes";
    // Half of the self-employment tax comes off income; the tax on the side money is what the
    // return owes with it less what it owes without (a part of it may still fall inside the
    // standard deduction), not the top rate on all of it.
    const withSide = federalTaxOf(
      baseIncome + pace - Math.round(se / 2),
      status,
      dependent,
      wagesYear + pace,
    );
    const income = Math.max(0, withSide - federalTaxOf(baseIncome, status, dependent, wagesYear));
    const rate = marginalRateFor(baseIncome + pace, status, dependent, wagesYear + pace);
    const tax = se + income;
    if (tax < TAX_SET_ASIDE.minLeftCents) return null;
    const payers = [...new Set(counted.map((t) => nice(t.description).split(" ")[0]))];
    const span = `${profile.months} month${profile.months === 1 ? "" : "s"}`;
    const appLine =
      apps.length > 0 && said === "mixed"
        ? ` You said your payment-app money is mixed, and I can't tell which part is work, so the ${formatCents(sumCents(apps))} cashed out of payment apps is left out of this figure.`
        : apps.length > 0 && said !== "work"
          ? ` The IRS doesn't count friends paying back for shared costs as income, so the ${formatCents(sumCents(apps))} cashed out of payment apps is left out of this figure.`
          : "";
    return suggestion("taxes", "side_income_tax", {
      title: `Nothing is withheld from your side income: about ${formatCents(tax)} of tax a year at this pace`,
      headline: headlineOf("Check tax on your side income", tax, "risk"),
      short: clip(
        `${formatCents(seen)} from ${payers.join(", ")} in ${span} besides your pay, nothing withheld.`,
      ),
      worthCents: tax,
      worthKind: "risk",
      rankCents: Math.round(tax * DETECTOR_RATES.tax.rankShareOfBill),
      confidence: weakest([
        evidence("seen", profile.months, counted.length, "payouts"),
        said === "work"
          ? factEvidence(facts.app_income)
          : {
              percent: 60,
              reason: "payouts are before any costs of the work, which lower the tax",
            },
      ]),
      urgency: urgencyForEstimated(profile.today),
      why: `You received ${formatCents(seen)} from ${payers.join(", ")} in ${span} besides your pay, about ${formatCents(pace)} a year at that pace, with nothing withheld.${appLine} Self-employment tax of ${Math.round(SIDE_INCOME.seRate * 1000) / 10}% (Social Security and Medicare) applies from ${formatWholeDollars(SIDE_INCOME.seFromCents)} of net earnings, and the earnings less their costs go into income: before costs, about ${formatCents(se)} and ${formatCents(income)} of income tax (your top rate is ${Math.round(rate * 100)}%). Payment apps send a Form 1099-K only above ${formatWholeDollars(SIDE_INCOME.appThreshold.cents)} and ${SIDE_INCOME.appThreshold.payments} payments, and the income counts either way (IRS). ${estimatedRule(facts.owed_tax_last_year.value, tax)} ${datesLine(profile.today, facts.home_state.value)}`,
      action: { label: "See your taxes", href: "/taxes" },
      more: [
        { label: "IRS: self-employment tax", href: SOURCES.seTax.url },
        { label: "IRS: Form 1099-K", href: SOURCES.form1099K.url },
      ],
    });
  },
};

export const SIDE_INCOME_DETECTORS: readonly Detector[] = [sideIncomeTax];
