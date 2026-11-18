import { DETECTOR_RATES } from "@/config/detectors";
import { TAX_SET_ASIDE } from "@/config/tax-set-aside";
import {
  ESTIMATED_TAX,
  FILING,
  IRS_REFUND,
  REFUND_SHOWN_FROM_CENTS,
  SOURCES,
  W4,
} from "@/config/student-taxes";
import type { FilingStatus } from "@/config/tax";
import { FEDERAL_BRACKETS, STANDARD_DEDUCTION } from "@/config/tax-rates";
import { dayLabel } from "@/lib/day-label";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { studentMoney, sumCents } from "@/planning/student-money";
import { dependentOf, federalTaxOf, filingStatusOf, onStudentVisa } from "@/planning/student-tax";
import { bracketTax } from "@/planning/tax-brackets";
import { selfEmploymentTax } from "@/planning/tax-estimate";
import { employerName } from "@/profile/employer-name";
import type { ProfileTx } from "@/profile/build";
import { type Detector, type Suggestion, suggestion } from "./contract";
import { evidence, headlineOf, nice, weakest } from "./helpers";
import { penaltyRule } from "./student-taxes";

// Paycheck withholding that's off, from the paychecks themselves and the year's tables (suggest-taxes,
// 11-18), and the date an extension doesn't move. Pub. 15-T withholds each paycheck as if that pay
// came every pay period of the year: a job that starts in the fall is withheld for a full year's
// income it won't earn (a refund building), and each of two jobs takes the whole standard deduction
// (a bill building). Facts and the person's own W-4 steps; pure.

const long = (day: string) => dayLabel(day, { long: true, year: true });
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// Paychecks a year from the usual days between them, or null for no steady rhythm.
function payRhythm(pay: readonly ProfileTx[]): { days: number; perYear: number } | null {
  const dates = pay.map((t) => t.date).sort();
  const gaps = dates
    .slice(1)
    .map((d, i) => daysBetween(dates[i], d))
    .sort((x, y) => x - y);
  if (gaps.length === 0) return null;
  const median = gaps[Math.floor(gaps.length / 2)];
  const match = W4.intervals.find((i) => median <= i.maxDays);
  return match && median > 0 ? { days: median, perYear: match.perYear } : null;
}

const RHYTHM_WORDS: Readonly<Record<number, string>> = {
  52: "every week",
  26: "every two weeks",
  24: "twice a month",
  12: "every month",
};

// Federal withholding on one paycheck of `gross` under the standard single W-4, with `perYear` of them.
export const withheldPerCheck = (gross: number, perYear: number, status: FilingStatus = "single") =>
  Math.round(
    bracketTax(
      Math.max(
        0,
        gross * perYear -
          (status === "single" ? W4.noWithholdingBelowCents : STANDARD_DEDUCTION[status]),
      ),
      FEDERAL_BRACKETS[status],
    ) / perYear,
  );

const gross = (net: number) => Math.round(net * DETECTOR_RATES.tax.netToGross);

// A job that started within the data, withheld as if it ran all year.
const partYearWithholding: Detector = {
  capability: "taxes",
  topic: "withholding_part_year",
  covers: ["tax_withholding"],
  needs: ["claimed_as_dependent", "owed_tax_last_year"],
  detect({ profile, data }): Suggestion | null {
    const { facts } = profile;
    if (onStudentVisa(facts) || filingStatusOf(facts) !== "single") return null;
    const money = studentMoney(data);
    // A fellowship's months before the job make the year's tax another sum: the fellowship card's.
    if (money.schoolDeposits.length > 0 || money.wages.length < 2) return null;
    const rhythm = payRhythm(money.wages);
    if (!rhythm) return null;
    const first = money.wages.map((t) => t.date).sort()[0];
    const dataFrom = data.transactions.map((t) => t.date).sort()[0];
    if (daysBetween(dataFrom, first) <= rhythm.days * W4.startGapIntervals) return null;
    const net = Math.round(sumCents(money.wages) / money.wages.length);
    const check = gross(net);
    // Paychecks from the first one to December 31 at its rhythm.
    const checks = Math.floor(daysBetween(first, `${money.year}-12-31`) / rhythm.days) + 1;
    const withheld = withheldPerCheck(check, rhythm.perYear) * checks;
    const dependent = dependentOf(facts) === "yes";
    const yearPay = check * checks;
    const tax = federalTaxOf(yearPay, "single", dependent, yearPay);
    const refund = withheld - tax;
    if (refund < TAX_SET_ASIDE.minLeftCents) return null;
    const employer = nice(employerName(money.wages[0].description)) || "your job";
    const exempt =
      tax === 0
        ? ` If you owed no federal income tax for ${ESTIMATED_TAX.noLiabilityYear} and expect none for ${ESTIMATED_TAX.taxYear}, ${W4.form}'s "Exempt from withholding" box stops it; a new ${W4.form} is due by ${long(W4.exemptRenewBy)} for the next year.`
        : "";
    return suggestion("taxes", "withholding_part_year", {
      title: `About ${formatCents(refund)} more than your ${money.year} tax is being withheld from your new job's pay`,
      headline: `Note: about ${formatWholeDollars(refund)} withheld beyond the year's tax`,
      short: `Pay from ${dayLabel(first)} is withheld as if it ran all year: about ${formatWholeDollars(refund)} too much.`,
      worthCents: refund,
      worthKind: "earns",
      // It comes back at filing anyway; having it now is worth a share of it.
      rankCents: Math.round(refund * DETECTOR_RATES.tax.rankShareOfBill),
      confidence: weakest([
        evidence("seen", profile.months, money.wages.length, "paychecks"),
        {
          percent: 50,
          reason: `pay starts ${dayLabel(first)} in your data; this assumes it's your only pay for ${money.year} and about ${Math.round((DETECTOR_RATES.tax.netToGross - 1) * 100)}% is taken out before it lands`,
        },
      ]),
      urgency: "soon",
      why: `Your pay from ${employer} starts ${long(first)}, about ${formatCents(net)} ${RHYTHM_WORDS[rhythm.perYear]}. Withholding tables (IRS Pub. 15-T) treat each paycheck as if it came all year: about ${formatCents(check)} before anything is taken out is ${formatCents(check * rhythm.perYear)} a year, withheld about ${formatCents(withheldPerCheck(check, rhythm.perYear))} a paycheck. Your ${checks} paychecks to December 31 come to about ${formatCents(yearPay)}, which carries ${formatCents(tax)} of federal income tax, so about ${formatCents(refund)} more is withheld than the year's tax, if this is your only pay this year. It comes back after you file. IRS Pub. 15-T has a part-year method for someone working no more than ${W4.partYearMaxDays} days in the year: withholding figured on what the year's pay really is, when the employee asks the employer for it in writing. Asking for it is yours to decide.${exempt}`,
      action: { label: "See your taxes", href: "/taxes" },
      more: [{ label: "IRS Pub. 15-T", href: SOURCES.pub15t.url }],
    });
  },
};

// Two jobs at once: each employer's withholding takes off the whole standard deduction.
const twoJobs: Detector = {
  capability: "taxes",
  topic: "withholding_two_jobs",
  covers: ["tax_withholding"],
  needs: ["claimed_as_dependent"],
  detect({ profile, data }): Suggestion | null {
    const { facts } = profile;
    const status = filingStatusOf(facts);
    if (onStudentVisa(facts) || status === "married_separate" || status === "head_of_household")
      return null;
    const money = studentMoney(data);
    const byPayer = new Map<string, ProfileTx[]>();
    for (const t of money.wages) {
      const name = employerName(t.description).toUpperCase();
      byPayer.set(name, [...(byPayer.get(name) ?? []), t]);
    }
    const jobs = [...byPayer.entries()]
      .filter(([, pay]) => pay.length >= W4.jobMinPaychecks)
      .map(([name, pay]) => ({ name, pay, rhythm: payRhythm(pay) }))
      .filter((j): j is typeof j & { rhythm: NonNullable<typeof j.rhythm> } => j.rhythm !== null);
    if (jobs.length !== 2) return null;
    const each = jobs.map((j) => {
      const check = gross(Math.round(sumCents(j.pay) / j.pay.length));
      return {
        ...j,
        check,
        year: check * j.rhythm.perYear,
        withheld: withheldPerCheck(check, j.rhythm.perYear, status) * j.rhythm.perYear,
      };
    });
    const year = each.reduce((s, j) => s + j.year, 0);
    const withheld = each.reduce((s, j) => s + j.withheld, 0);
    const dependent = dependentOf(facts) === "yes";
    const tax = federalTaxOf(year, status, dependent, year);
    const short = tax - withheld;
    if (short < TAX_SET_ASIDE.minLeftCents) return null;
    const [a, b] = each;
    return suggestion("taxes", "withholding_two_jobs", {
      title: `Withholding on two paychecks falls about ${formatCents(short)} short of a year's tax on both`,
      headline: headlineOf("Check withholding on two paychecks", short, "risk"),
      short: `Each job withholds as if it were your only one: about ${formatWholeDollars(short)} short a year.`,
      worthCents: short,
      worthKind: "risk",
      rankCents: Math.round(short * DETECTOR_RATES.tax.rankShareOfBill),
      confidence: weakest([
        evidence(
          "seen",
          profile.months,
          a.pay.length + b.pay.length,
          "paychecks from two employers",
        ),
        {
          percent: 55,
          reason:
            "a year of both at today's pay, from take-home pay grossed up; I can't see whether a W-4 already allows for the other",
        },
      ]),
      urgency: "later",
      why: `Paychecks come from ${nice(employerName(a.pay[0].description))} and ${nice(employerName(b.pay[0].description))} (two jobs, or two earners on one joint return): about ${formatCents(a.year)} and ${formatCents(b.year)} a year before anything is taken out. Each employer's withholding counts the whole standard amount everyone gets, so together, if neither W-4 allows for the other, they withhold about ${formatCents(withheld)} a year against ${formatCents(tax)} of tax on ${formatCents(year)}: about ${formatCents(short)} short at filing. ${W4.form}'s Step 2 is for two jobs at once, or a joint return where both work: with only two jobs, its box checked on both W-4s splits that amount between them (IRS). ${penaltyRule(facts.owed_tax_last_year.value, false, short)}`,
      action: { label: "See your taxes", href: "/taxes" },
    });
  },
};

// From March to the due date, for someone with money nothing was withheld from: an extension moves
// filing to October, never paying.
const extensionNotToPay: Detector = {
  capability: "taxes",
  topic: "filing_extension",
  covers: ["tax_calendar"],
  needs: [],
  detect({ profile, data }): Suggestion | null {
    const { facts, today } = profile;
    const due = `${today.slice(0, 4)}-${FILING.due.slice(5)}`;
    if (today.slice(5) < W4.extensionFrom || today > due) return null;
    if (onStudentVisa(facts)) return null;
    const year = Number(today.slice(0, 4)) - 1;
    const untaxed = data.transactions.filter(
      (t) =>
        t.amountCents < 0 &&
        t.date.startsWith(`${year}-`) &&
        (t.pfc === "INCOME_GIG_ECONOMY" || t.pfc === "INCOME_CONTRACTOR"),
    );
    const school = studentMoney({ ...data, today: `${year}-12-31` }).schoolDeposits;
    const said = facts.school_deposit.value;
    const all = [...untaxed, ...(said === "wage" || said === "aid_refund" ? [] : school)];
    if (all.length === 0) return null;
    const received = sumCents(all);
    // Income tax on all of it, and self-employment tax on the gig and contract part (no employer
    // paid its share).
    const tax =
      federalTaxOf(received, filingStatusOf(facts), dependentOf(facts) === "yes", received) +
      selfEmploymentTax(sumCents(untaxed), 0);
    if (tax < TAX_SET_ASIDE.minLeftCents) return null;
    const days = daysBetween(today, due);
    const extended = `${due.slice(0, 4)}-${FILING.extendedTo.slice(5)}`;
    return suggestion("taxes", "filing_extension", {
      title: `An extension moves filing to ${long(extended)}, not paying: tax on ${year}'s untaxed income is due ${long(due)}`,
      headline: `Note: an extension doesn't move the ${dayLabel(due)} payment`,
      short: `${formatCents(received)} of ${year} income had nothing withheld; its tax is due ${dayLabel(due)}.`,
      worthCents: tax,
      worthKind: "risk",
      rankCents: Math.round(tax * DETECTOR_RATES.tax.rankShareOfBill),
      confidence: weakest([
        evidence("seen", profile.months, all.length, "deposits with nothing withheld"),
        { percent: 60, reason: "the tax is figured on these deposits alone, before credits" },
      ]),
      urgency: days <= 14 ? "now" : "soon",
      why: `You received ${formatCents(received)} in ${year} that nothing was withheld from (gig or contract pay, or school money that isn't pay). The ${year} return is due ${long(due)}, ${days} day${days === 1 ? "" : "s"} from now. ${FILING.federalExtensionForm} gives until ${long(extended)} to file, and California gives the same six months without a form. Neither is more time to pay (the IRS's and FTB's extension pages): the April date stays, and FTB charges penalties and interest after it. On these deposits alone the federal income and self-employment tax is about ${formatCents(tax)}.`,
      action: { label: "See your taxes", href: "/taxes" },
    });
  },
};

// A federal refund beside a paycheck (the gap pass: an upload showed $842 from the IRS in March and a
// steady paycheck, and Jane said nothing): last year's withholding ran ahead of the tax by about that
// much, unless a refundable credit made it. What's withheld comes back only after filing; Form W-4
// sets it, and the IRS's estimator fills one in.
const refundWithholding: Detector = {
  capability: "taxes",
  topic: "refund_withholding",
  covers: ["tax_withholding"],
  needs: [],
  detect({ profile, data }): Suggestion | null {
    const year = Number(profile.today.slice(0, 4));
    const refunds = data.transactions.filter(
      (t) =>
        t.amountCents < 0 &&
        t.date.startsWith(`${year}-`) &&
        t.date <= profile.today &&
        // The IRS's own wording, or a refund the bank filed as a tax refund that names the IRS.
        (IRS_REFUND.test(t.description.toUpperCase()) ||
          (t.pfc === "INCOME_TAX_REFUND" && /\bIRS\b/i.test(t.description))),
    );
    const refund = sumCents(refunds);
    if (refund < REFUND_SHOWN_FROM_CENTS) return null;
    const money = studentMoney(data);
    // Beside a paycheck, and not beside a fellowship, whose tax the refund says nothing about.
    if (money.wages.length === 0 || money.schoolDeposits.length > 0) return null;
    const monthly = Math.round(refund / 12);
    const when = dayLabel(refunds[0].date, { long: true, year: true });
    return suggestion("taxes", "refund_withholding", {
      title: `Your ${year - 1} federal refund was ${formatCents(refund)}: about ${formatCents(monthly)} a month withheld beyond the tax`,
      headline: `Check your withholding: last refund ${formatWholeDollars(refund)}`,
      short: `A ${formatCents(refund)} IRS refund on ${dayLabel(refunds[0].date)} beside your pay: about ${formatCents(monthly)} a month.`,
      worthCents: refund,
      worthKind: "earns",
      // It comes back at filing anyway; having it in each paycheck is worth a share of it.
      rankCents: Math.round(refund * DETECTOR_RATES.tax.rankShareOfBill),
      confidence: weakest([
        evidence("seen", profile.months, refunds.length, "IRS refunds"),
        {
          percent: 60,
          reason:
            "a refund can come from a credit rather than withholding, and this year's pay may differ",
        },
      ]),
      urgency: profile.today.slice(5, 7) === "01" ? "soon" : "later",
      why: `The IRS paid you ${formatCents(refund)} on ${when}, for ${year - 1}. A refund is tax taken from pay beyond the year's tax, or a refundable credit: on withholding alone, about ${formatCents(monthly)} a month of your pay went to the IRS early. Form W-4 sets how much your employer withholds, and the IRS's Tax Withholding Estimator fills one in from your pay; what's withheld comes back only after a return. If this year's pay or credits differ from last year's, so will the refund.`,
      action: { label: "See your taxes", href: "/taxes" },
      more: [{ label: "IRS: Tax Withholding Estimator", href: SOURCES.withholdingEstimator.url }],
    });
  },
};

export const STUDENT_WITHHOLDING_DETECTORS: readonly Detector[] = [
  partYearWithholding,
  twoJobs,
  extensionNotToPay,
  refundWithholding,
];
