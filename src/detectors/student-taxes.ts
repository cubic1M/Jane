import { DETECTOR_RATES } from "@/config/detectors";
import { CA_ESTIMATED_TAX, ESTIMATED_TAX, FILING, INTERNATIONAL } from "@/config/student-taxes";
import { dayLabel } from "@/lib/day-label";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { rateMonthsOf } from "@/profile/build";
import { studentMoney, sumCents } from "@/planning/student-money";
import {
  dependentOf,
  federalTaxOf,
  filingStatusOf,
  nextEstimatedDate,
  onStudentVisa,
} from "@/planning/student-tax";
import { TAX_SET_ASIDE } from "@/config/tax-set-aside";
import { type Detector, type Suggestion, suggestion } from "./contract";
import { clip, evidence, factEvidence, headlineOf, nice, weakest } from "./helpers";
import { urgencyForEstimated } from "./taxes";

// Tax on money that arrives with nothing withheld, for students (suggest-taxes, 11-18): a
// fellowship's stipend paid from the student account, and what an international student files.
// Facts on the person's own deposits and the published rules (src/config/student-taxes.ts), never
// what to do with their money: a real account gets the arithmetic, the dates and the rule. Pure;
// see ./contract.ts.

const long = (day: string) => dayLabel(day, { long: true, year: true });
const isStanford = (description: string) => /\bSTANFORD\b/i.test(description);
// A payer as people say it, without the ACH tail ("PPD ID: 1946001").
const payerOf = (description: string) => nice(description).replace(/\s+Ppd\b.*$/i, "");

// The penalty rule that applies to them, in a sentence: the no-2025-tax exception when they said
// they owed none, the $1,000 floor under it, or the safe harbour.
export function penaltyRule(owedLastYear: unknown, visa: boolean, taxCents: number): string {
  const due = long(FILING.due);
  if (owedLastYear === "no" && !visa)
    return `You said you owed no federal income tax for ${ESTIMATED_TAX.noLiabilityYear}: if you were a US citizen or resident all that year, the IRS doesn't require ${ESTIMATED_TAX.taxYear} estimated payments (Pub. 505). The tax itself is still due by ${due}.`;
  if (taxCents < ESTIMATED_TAX.requiredFromCents)
    return `Under ${formatWholeDollars(ESTIMATED_TAX.requiredFromCents)} owed at filing, the IRS doesn't require estimated payments (Pub. 505); it's due by ${due}.`;
  return `Owing ${formatWholeDollars(ESTIMATED_TAX.requiredFromCents)} or more at filing brings an underpayment penalty unless withholding and estimated payments reach the smaller of ${Math.round(ESTIMATED_TAX.thisYearShare * 100)}% of ${ESTIMATED_TAX.taxYear}'s tax or ${Math.round(ESTIMATED_TAX.lastYearShare * 100)}% of ${ESTIMATED_TAX.noLiabilityYear}'s (${Math.round(ESTIMATED_TAX.lastYearShareHigh * 100)}% if ${ESTIMATED_TAX.noLiabilityYear}'s AGI was over ${formatWholeDollars(ESTIMATED_TAX.highAgiCents)}), Pub. 505.`;
}

// The next federal date, and California's when they live there.
export function datesLine(today: string, state: unknown): string {
  const next = nextEstimatedDate(today);
  if (!next) return `The ${ESTIMATED_TAX.taxYear} return is due ${long(FILING.due)}.`;
  const january = next.due === ESTIMATED_TAX.dates[3].due;
  const federal = `The next federal estimated payment date is ${long(next.due)}, for income from ${next.covers}${january ? ` (or file the whole ${ESTIMATED_TAX.taxYear} return and pay it by ${long(ESTIMATED_TAX.fileInsteadOfJanuaryBy)})` : ""}.`;
  if (state !== "CA") return federal;
  const ca = CA_ESTIMATED_TAX.dates.find((d) => d.due >= today && d.share > 0);
  return ca
    ? `${federal} California's next date is ${long(ca.due)}, for ${Math.round(ca.share * 100)}% of its year when ${formatWholeDollars(CA_ESTIMATED_TAX.requiredFromCents)} or more is owed (FTB).`
    : federal;
}

// A fellowship's stipend: taxable for the part not for tuition and required books, and Stanford
// withholds nothing from it for US students. The tax at the deposits' pace, the rule and the date.
const stipendTax: Detector = {
  capability: "taxes",
  topic: "stipend_tax",
  covers: ["tax_estimate"],
  needs: ["school_deposit", "claimed_as_dependent", "owed_tax_last_year", "tax_residency"],
  detect({ profile, data }): Suggestion | null {
    const { facts } = profile;
    const said = facts.school_deposit.value;
    if (said === "wage" || said === "aid_refund") return null;
    // A nonresident's fellowship is withheld at Stanford and taxed under other rules.
    if (onStudentVisa(facts)) return null;
    const money = studentMoney(data);
    const deposits = money.schoolDeposits;
    if (deposits.length === 0) return null;
    const months = rateMonthsOf(profile);
    const received = sumCents(deposits);
    const yearly = Math.round((received * 12) / months);
    const wages = Math.round((sumCents(money.wages) * 12) / months);
    const status = filingStatusOf(facts);
    const dependent = dependentOf(facts) === "yes";
    const earned = yearly + wages;
    const tax =
      federalTaxOf(earned, status, dependent, earned) -
      federalTaxOf(wages, status, dependent, earned);
    if (tax < TAX_SET_ASIDE.minLeftCents) return null;
    const stanford = deposits.some((t) => isStanford(t.description));
    const payer = stanford ? "Stanford's student account" : payerOf(deposits[0].description);
    const span = `${profile.months} month${profile.months === 1 ? "" : "s"}`;
    const withheld = stanford
      ? "Stanford doesn't withhold tax from fellowship stipends for US citizens, permanent residents and tax residents (its Payroll page), and"
      : "If nothing was withheld from these deposits,";
    const kind =
      said === "fellowship"
        ? "you told me these are a fellowship"
        : money.stipendNamed
          ? "they say they're a stipend or fellowship"
          : "they come from the student account, so they may be a fellowship's stipend or aid money; which, only you know";
    return suggestion("taxes", "stipend_tax", {
      title: `Nothing is withheld from your fellowship: about ${formatCents(tax)} of ${money.year} federal tax at this pace`,
      headline: headlineOf("Check tax on your fellowship", tax, "risk"),
      short: clip(
        `${formatCents(received)} from your school in ${span}, nothing withheld: about ${formatCents(Math.round(tax / 12))} of tax a month.`,
      ),
      worthCents: tax,
      worthKind: "risk",
      // Owed whatever Jane says; knowing it avoids the surprise and the penalty, so it ranks for a share.
      rankCents: Math.round(tax * DETECTOR_RATES.tax.rankShareOfBill),
      confidence: weakest([
        said === "fellowship"
          ? factEvidence(facts.school_deposit)
          : evidence(
              money.stipendNamed ? "seen" : "guessed",
              profile.months,
              deposits.length,
              "school deposits",
            ),
        {
          ...evidence("seen", profile.months, deposits.length, "school deposits"),
          reason: `${evidence("seen", profile.months, deposits.length, "school deposits").reason}, carried to a year at that pace`,
        },
      ]),
      urgency: urgencyForEstimated(profile.today),
      why: `${withheld} IRS Pub. 970 puts the part of a fellowship that isn't for tuition and required books on Schedule 1 line 8r, with income. You received ${formatCents(received)} from ${payer} in ${span} (${kind}). At that pace, ${formatCents(yearly)} for the year carries about ${formatCents(tax)} of federal income tax, ${formatCents(Math.round(tax / 12))} a month, before any credits. ${penaltyRule(facts.owed_tax_last_year.value, false, tax)} ${datesLine(profile.today, facts.home_state.value)} This is arithmetic on your deposits, not tax advice.`,
      action: { label: "See your tax estimate", href: "/taxes" },
    });
  },
};

// An international student on an F or J visa: what they file, and that the resident credits aren't
// theirs, with Stanford's and the IRS's own pages. No dollars: the forms are what's due.
const internationalStudent: Detector = {
  capability: "taxes",
  topic: "student_tax_residency",
  covers: ["tax_calendar"],
  needs: ["tax_residency"],
  detect({ profile, data }): Suggestion | null {
    const { facts } = profile;
    if (!onStudentVisa(facts)) return null;
    const money = studentMoney(data);
    const fellowship = money.schoolDeposits.length > 0;
    const pay = money.schoolPay.length > 0;
    const stanford = [...money.schoolDeposits, ...money.schoolPay].some((t) =>
      isStanford(t.description),
    );
    const withheld = stanford
      ? ` Stanford withholds ${Math.round(INTERNATIONAL.stanfordFellowshipWithholding * 100)}% from nonresidents' fellowship and award payments and reports them on Form 1042-S; a tax treaty can lower that.`
      : "";
    return suggestion("taxes", "student_tax_residency", {
      title: "On a student visa, the tax forms and credits are different",
      headline: "Note the tax forms for your student visa",
      short:
        fellowship || pay
          ? "Form 8843 every year, Form 1040-NR for US income; resident credits don't apply."
          : "Form 8843 every year, even with no US income.",
      worthCents: 0,
      worthKind: "risk",
      required: true,
      confidence: factEvidence(facts.tax_residency),
      urgency: "later",
      why: `You told me you're on an F or J student visa. Students on these visas are often nonresidents for US tax; the IRS's substantial presence test decides. A nonresident student files Form 8843 every year, even with no US income (Stanford's Bechtel Center: by mid-June when there's no US income), and Form 1040-NR with it when there was US income${fellowship || pay ? ", as you had" : ""}.${withheld} The American opportunity credit isn't for a nonresident alien (IRS Pub. 970), and the earned income credit is for US citizens and residents (IRS). Bechtel's pages and Sprintax, which Stanford gives its students, walk through the forms.`,
      action: { label: "See your taxes", href: "/taxes" },
      more: INTERNATIONAL.links.map((l) => ({ label: l.label, href: l.href })),
    });
  },
};

export const STUDENT_TAX_DETECTORS: readonly Detector[] = [stipendTax, internationalStudent];
