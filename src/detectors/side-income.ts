import { DETECTOR_RATES } from "@/config/detectors";
import { SIDE_INCOME, SOURCES } from "@/config/student-taxes";
import { TAX_SET_ASIDE } from "@/config/tax-set-aside";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { sumCents } from "@/planning/student-money";
import {
  dependentOf,
  filingStatusOf,
  marginalRateFor,
  onStudentVisa,
  studentYearOf,
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
    const months = rateMonthsOf(profile);
    const seen = sumCents(counted);
    const pace = Math.round((seen * 12) / months);
    const wagesYear = studentYearOf(data, facts, months).wagesCents;
    const status = filingStatusOf(facts);
    const se = selfEmploymentTax(pace, wagesYear);
    const rate = marginalRateFor(
      wagesYear + pace,
      status,
      dependentOf(facts) === "yes",
      wagesYear + pace,
    );
    const income = Math.round(pace * rate);
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
      why: `You received ${formatCents(seen)} from ${payers.join(", ")} in ${span} besides your pay, about ${formatCents(pace)} a year at that pace, with nothing withheld.${appLine} Self-employment tax of ${Math.round(SIDE_INCOME.seRate * 1000) / 10}% (Social Security and Medicare) applies from ${formatWholeDollars(SIDE_INCOME.seFromCents)} of net earnings, and the earnings less their costs go into income: before costs, about ${formatCents(se)} and ${formatCents(income)} at your ${Math.round(rate * 100)}% rate. Payment apps send a Form 1099-K only above ${formatWholeDollars(SIDE_INCOME.appThreshold.cents)} and ${SIDE_INCOME.appThreshold.payments} payments, and the income counts either way (IRS). ${penaltyRule(facts.owed_tax_last_year.value, false, tax)} ${datesLine(profile.today, facts.home_state.value)}`,
      action: { label: "See your taxes", href: "/taxes" },
      more: [
        { label: "IRS: self-employment tax", href: SOURCES.seTax.url },
        { label: "IRS: Form 1099-K", href: SOURCES.form1099K.url },
      ],
    });
  },
};

export const SIDE_INCOME_DETECTORS: readonly Detector[] = [sideIncomeTax];
