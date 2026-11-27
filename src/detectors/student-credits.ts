import { CA_RENTERS_CREDIT, AOTC_FORM, SOURCES, TUITION_TIMING_FROM } from "@/config/student-taxes";
import { EDUCATION_CREDITS, EITC, STUDENT_LOAN_INTEREST } from "@/config/tax-rates";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { dayLabel } from "@/lib/day-label";
import { formatRate } from "@/lib/percent";
import { plural } from "@/lib/plural";
import { studentMoney, sumCents } from "@/planning/student-money";
import {
  age25to64,
  aotcRefundableAge,
  dependentOf,
  federalTaxOf,
  filingStatusOf,
  marginalRateFor,
  studentYearOf,
  yearCoverageMonths,
} from "@/planning/student-tax";
import { earnedIncomeCredit } from "@/planning/tax-estimate";
import { RESIDENCY_NOTE, residentOnlyAllowed } from "@/planning/tax-engine/residency-gate";
import { yearInterest } from "@/planning/lender-interest";
import { rateMonthsOf, type Profile } from "@/profile/build";
import { stateMove } from "@/profile/home-state";
import { type Confidence, type Detector, type Suggestion, suggestion } from "./contract";
import { monthlyPaymentOf } from "./debt";
import { evidence, factEvidence, headlineOf, incomeYearOf, nameOf, nice, weakest } from "./helpers";

// Credits and deductions a student or first-job earner commonly leaves unclaimed (suggest-taxes,
// 11-18), each from what the bank shows: tuition they paid, student-loan payments, low pay, rent in
// California. What it's worth for this person by the published formula, who can't take it, and the
// form line. Facts for every account: what a credit is and what it comes to, never whether to file
// for it. Figures in src/config/tax-rates.ts and src/config/student-taxes.ts. Pure.

const span = (profile: Profile) => `${profile.months} month${profile.months === 1 ? "" : "s"}`;
const pct = (rate: number) => `${Math.round(rate * 100)}%`;
// The share of a credit left over a phase-out range: all of it to `from`, none from `to`.
export const phaseLeft = (agi: number, [from, to]: readonly [number, number]) =>
  agi <= from ? 1 : agi >= to ? 0 : (to - agi) / (to - from);
const share = phaseLeft;

// What a fact the person hasn't given yet does to the confidence: as sure as the rest, at most this,
// with the reason said.
const notSaid = (percent: number, reason: string): Confidence => ({ percent, reason });

// Tuition paid from their own account: the lifetime learning credit on it, and the American
// opportunity credit for an undergraduate at least half time.
const educationCredit: Detector = {
  capability: "taxes",
  topic: "education_credit",
  covers: ["tax_savings"],
  needs: ["enrollment", "claimed_as_dependent", "tax_residency", "age_25_plus"],
  detect({ profile, data }): Suggestion | null {
    const { facts } = profile;
    // For residents only (IRS Pub. 519): held back until they've said they're a citizen or green
    // card holder. The question that settles it lists this card among what it decides.
    if (!residentOnlyAllowed(facts)) return null;
    const status = filingStatusOf(facts);
    if (status === "married_separate") return null;
    const money = studentMoney(data);
    if (money.tuition.length === 0) return null;
    const paid = sumCents(money.tuition);
    const year = studentYearOf(data, facts, rateMonthsOf(profile));
    const range =
      status === "married_joint"
        ? EDUCATION_CREDITS.phaseOut.married_joint
        : EDUCATION_CREDITS.phaseOut.single;
    // A dependent's credit goes on the return of whoever claims them, and their income and filing
    // status set the phase-out, which Jane doesn't see: the student's own income says nothing of it.
    const dependent = dependentOf(facts) === "yes";
    // Their own income past the range still says nothing: that is no dependent's credit to show.
    const own = share(year.agiCents, range);
    if (own === 0) return null;
    const left = dependent ? 1 : own;
    const enrollment = facts.enrollment.value;
    const undergrad = enrollment === "undergrad";
    const aotc = Math.round(
      (Math.min(paid, AOTC_FORM.firstCents) +
        AOTC_FORM.secondRate *
          Math.min(Math.max(0, paid - AOTC_FORM.firstCents), AOTC_FORM.secondCents)) *
        left,
    );
    const llc = Math.round(
      Math.min(paid, EDUCATION_CREDITS.llcCostLimit) * EDUCATION_CREDITS.llcRate * left,
    );
    const tax = federalTaxOf(year.agiCents, status, dependent, year.earnedCents);
    // The refundable 40% isn't paid to a full-time student under 24 with a living parent (Form 8863
    // line 7): only someone known to be 24 or older counts on it (the credit has no upper age).
    const refundable = aotcRefundableAge(facts) === true;
    const aotcHere = refundable
      ? Math.min(Math.round(aotc * (1 - AOTC_FORM.refundableShare)), tax) +
        Math.round(aotc * AOTC_FORM.refundableShare)
      : Math.min(aotc, tax);
    const llcHere = Math.min(llc, tax);
    // A dependent's credit goes on the return of whoever claims them: worth the whole credit there.
    const worth = dependent
      ? undergrad
        ? Math.max(aotc, llc)
        : llc
      : undergrad
        ? Math.max(aotcHere, llcHere)
        : llcHere;
    if (worth <= 0) return null;
    const name =
      undergrad && (dependent ? aotc >= llc : aotcHere >= llcHere)
        ? "American opportunity credit"
        : "lifetime learning credit";
    const where = dependent
      ? `You said you're someone's dependent: then the credit goes on that person's return, not yours, for the tuition you paid.`
      : `It lowers federal income tax owed${name === "American opportunity credit" ? (refundable ? `, and ${pct(AOTC_FORM.refundableShare)} of it is paid even with no tax owed` : "; its refundable part isn't paid to most full-time students under 24 with a living parent (Form 8863 instructions)") : ""}: about ${formatCents(tax)} of tax on your income at its pace, so ${formatCents(worth)} of it is yours to use.`;
    const aotcLine = undergrad
      ? ""
      : ` If you're an undergraduate in your first four years, at least half time, the American opportunity credit is ${pct(1)} of the first ${formatWholeDollars(AOTC_FORM.firstCents)} and ${pct(AOTC_FORM.secondRate)} of the next ${formatWholeDollars(AOTC_FORM.secondCents)}: ${formatCents(aotc)} on what you paid.`;
    return suggestion("taxes", "education_credit", {
      title: dependent
        ? `The ${name} may come to up to ${formatCents(worth)} on the tuition you paid, on the return of whoever claims you`
        : `The ${name} may come to about ${formatCents(worth)} on the tuition you paid`,
      headline: headlineOf("Check the education credit", worth, "earns", true),
      short: dependent
        ? `You paid ${formatCents(paid)} in tuition; the ${name} on it goes on the return you're a dependent on.`
        : `You paid ${formatCents(paid)} in tuition this year; the ${name} is figured on it.`,
      worthCents: worth,
      worthKind: "earns",
      confidence: weakest([
        evidence("seen", profile.months, money.tuition.length, "tuition payments"),
        enrollment === null
          ? notSaid(60, "I don't know if you're at least half time or an undergraduate")
          : factEvidence(facts.enrollment),
        dependentOf(facts) === null
          ? notSaid(55, "I don't know if someone claims you as a dependent")
          : factEvidence(facts.claimed_as_dependent),
        ...(dependent
          ? [
              notSaid(
                45,
                "the credit's limit depends on the income of whoever claims you, which I can't see",
              ),
            ]
          : []),
      ]),
      urgency: "later",
      why: `You paid ${formatCents(paid)} in tuition to ${nameOf(money.tuition[0]).replace(/\s+Tuition.*$/i, "")} in ${span(profile)}. The lifetime learning credit is ${pct(EDUCATION_CREDITS.llcRate)} of up to ${formatWholeDollars(EDUCATION_CREDITS.llcCostLimit)} paid: ${formatCents(llc)} on yours.${aotcLine} ${where} Both shrink from ${formatWholeDollars(range[0])} to ${formatWholeDollars(range[1])} of income and aren't for a married person who files separately (IRS Pub. 970); tuition a scholarship paid isn't in the figure. ${RESIDENCY_NOTE} The school's Form 1098-T shows what was paid; the IRS's Form 8863 instructions have the rest.${profile.today.slice(5) >= TUITION_TIMING_FROM ? ` Tuition paid by December 31 for a term that starts by the end of March counts toward ${profile.today.slice(0, 4)}'s credits; paid in January, toward the next year's (Form 8863 instructions).` : ""}`,
      action: { label: "See your taxes", href: "/taxes" },
      more: [{ label: "IRS: Form 8863 instructions", href: SOURCES.form8863.url }],
    });
  },
};

// Student-loan payments: the interest part comes off income, up to $2,500, without itemizing.
const studentLoanInterest: Detector = {
  capability: "taxes",
  topic: "student_loan_interest",
  covers: ["tax_savings"],
  needs: ["claimed_as_dependent"],
  detect({ profile, data }): Suggestion | null {
    const { facts } = profile;
    // A nonresident alien can take it too (IRS Pub. 519, Deductions: student loan interest).
    if (dependentOf(facts) === "yes") return null;
    const status = filingStatusOf(facts);
    const range = STUDENT_LOAN_INTEREST.phaseOut[status];
    if (!range) return null;
    const money = studentMoney(data);
    if (money.loanPayments.length === 0) return null;
    const months = rateMonthsOf(profile);
    // The usual month's payment, as the student-loan plan card says it (src/detectors/debt.ts), not
    // their sum over the months of data: four $217.40 payments in 3.9 months read as $2,691.71 a
    // year beside "$217.40 a month" (debug 2, 11-18).
    const monthly = monthlyPaymentOf(money.loanPayments);
    const paidYear = monthly * 12;
    const year = studentYearOf(data, facts, months);
    const left = share(year.agiCents, range);
    const rate = marginalRateFor(year.agiCents, status, false, year.earnedCents);
    // The interest part isn't in a payment. The lender's own year to date, paced to the year by its
    // payments (the ones seen here) or the day it was read; else a year's interest from the balance
    // and rate, at most the whole payment
    // (src/planning/lender-interest.ts, as the tax estimate reads it, so Taxes says one figure:
    // debug 2, 11-20, "about $882.96" beside the audit pack's $971.91). The year is the one this
    // card's income is for (incomeYearOf): in January a year's interest from December's reading
    // would be last year's.
    const interestYear = incomeYearOf(data);
    const found = yearInterest(
      data.liabilities.flatMap((l) => {
        const account = data.accounts.find((a) => a.id === l.accountId);
        return l.kind === "student"
          ? [
              {
                ytdInterestPaidCents: l.ytdInterestPaidCents ?? null,
                readOn: l.ytdInterestReadOn ?? null,
                lastPaymentDate: l.lastPaymentDate ?? null,
                balanceCents:
                  account && account.balanceKnown !== false ? account.balanceCents : null,
                aprBps: l.aprBps,
              },
            ]
          : [];
      }),
      interestYear,
      data.today,
      {
        dates: money.loanPayments.map((t) => t.date),
        dataFrom: data.transactions.reduce<string | null>(
          (a, t) => (a === null || t.date < a ? t.date : a),
          null,
        ),
      },
    );
    const interest =
      found === null
        ? null
        : found.from === "lender"
          ? found.cents
          : Math.min(paidYear, found.cents);
    const deduct = Math.round(Math.min(STUDENT_LOAN_INTEREST.max, interest ?? paidYear) * left);
    const worth = Math.round(deduct * rate);
    if (worth <= 0) return null;
    const basis =
      found === null
        ? null
        : found.from === "lender"
          ? `Your lender reports ${formatCents(found.reportedCents)} of interest paid in ${interestYear} ${found.payments !== null ? `through ${plural(found.payments, "payment")} (last ${dayLabel(found.asOf)})` : `by ${dayLabel(found.asOf)}`}, about ${formatCents(found.cents)} for the year`
          : `On ${formatCents(found.balanceCents)} owed at ${formatRate(found.aprBps)}${found.loans > 1 ? " and more" : ""}, a year's interest is about ${formatCents(Math.min(paidYear, found.cents))}`;
    const lender = nice(money.loanPayments[0].description).replace(
      // A bank's short form too: "NELNET STUDENT LN PAYMENT" read as "Nelnet Student Ln"
      // (debug 2, 11-18).
      /\s+(?:Student\s+L(?:oa)?n|Payment).*$/i,
      "",
    );
    return suggestion("taxes", "student_loan_interest", {
      title: `Student loan interest can come off income, up to ${formatWholeDollars(STUDENT_LOAN_INTEREST.max)} (IRS Pub. 970)`,
      headline: headlineOf("Check the student loan interest", worth, "saves"),
      short: `${formatCents(sumCents(money.loanPayments))} to ${lender} in ${span(profile)}; its interest part lowers income.`,
      worthCents: worth,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, money.loanPayments.length, "student loan payments"),
        interest === null
          ? notSaid(
              45,
              "a payment is part interest and part loan; the lender's Form 1098-E says how much",
            )
          : found?.from === "lender"
            ? notSaid(75, "a year's interest paced from what your lender reports so far")
            : notSaid(75, "a year's interest worked out from your loan's balance and rate"),
        dependentOf(facts) === null
          ? notSaid(55, "I don't know if someone claims you as a dependent")
          : factEvidence(facts.claimed_as_dependent),
      ]),
      urgency: "later",
      why: `You paid ${formatCents(sumCents(money.loanPayments))} to ${lender} in ${span(profile)}, about ${formatCents(paidYear)} a year at ${formatCents(monthly)} a month. The interest part of student-loan payments comes off income up to ${formatWholeDollars(STUDENT_LOAN_INTEREST.max)} a year, on top of the standard amount everyone gets; the lender's Form 1098-E shows the interest. ${basis === null ? `At the ${pct(rate)} rate your income reaches, up to ${formatCents(deduct)} of interest is worth up to ${formatCents(worth)} of tax` : `${basis}; at the ${pct(rate)} rate your income reaches, ${formatCents(deduct)} of it is worth about ${formatCents(worth)} of tax`}; the 1098-E's interest figure is the real one. Not for a dependent on someone else's return or a married person who files separately, and it shrinks from ${formatWholeDollars(range[0])} to ${formatWholeDollars(range[1])} of income (IRS Pub. 970, Rev. Proc. 2025-32).`,
      action: { label: "See your taxes", href: "/taxes" },
      more: [{ label: "IRS Pub. 970", href: SOURCES.pub970.url }],
    });
  },
};

// Low pay and no children: the earned income credit, paid even with no tax owed, from 25 to 64.
const earnedIncomeCreditCard: Detector = {
  capability: "taxes",
  topic: "earned_income_credit",
  covers: ["tax_savings"],
  needs: ["age_25_plus", "claimed_as_dependent", "tax_residency"],
  detect({ profile, data }): Suggestion | null {
    const { facts } = profile;
    if (!residentOnlyAllowed(facts)) return null;
    if (dependentOf(facts) === "yes" || facts.has_children.value === true) return null;
    if (age25to64(facts) !== true) return null;
    const status = filingStatusOf(facts);
    if (status === "married_separate") return null;
    const year = studentYearOf(data, facts, rateMonthsOf(profile));
    if (year.earnedCents <= 0) return null;
    // Interest seen this year, paced like the pay: it counts toward income and the credit's
    // investment-income limit (studentYearOf leaves it out of income).
    const interest = Math.round(
      (data.transactions
        .filter(
          (t) =>
            t.amountCents < 0 &&
            t.pfc === "INCOME_INTEREST_EARNED" &&
            t.date.startsWith(data.today.slice(0, 4)) &&
            t.date <= data.today,
        )
        .reduce((n, t) => n - t.amountCents, 0) *
        12) /
        yearCoverageMonths(data, rateMonthsOf(profile)),
    );
    const credit = earnedIncomeCredit({
      status,
      children: 0,
      earnedCents: year.earnedCents,
      agiCents: year.agiCents + interest,
      investmentIncomeCents: interest,
      age: EITC.childlessMinAge,
    });
    if (credit <= 0) return null;
    const limit =
      status === "married_joint" ? EITC.phaseOutFrom.married_joint[0] : EITC.phaseOutFrom.single[0];
    const end = limit + Math.round(EITC.maxCredit[0] / EITC.phaseOutRate[0]);
    return suggestion("taxes", "earned_income_credit", {
      title: `The earned income credit may come to about ${formatCents(credit)} for ${data.today.slice(0, 4)}`,
      headline: headlineOf("Check the earned income credit", credit, "earns", true),
      short: `Pay near ${formatCents(year.earnedCents)} a year is under its ${formatWholeDollars(end)} limit without children.`,
      worthCents: credit,
      worthKind: "earns",
      confidence: weakest([
        evidence("seen", profile.months, Math.max(1, profile.months), "months of pay"),
        notSaid(
          60,
          "your year's pay is carried from the months seen; the credit uses the whole year's",
        ),
        dependentOf(facts) === null
          ? notSaid(55, "I don't know if someone claims you as a dependent")
          : factEvidence(facts.claimed_as_dependent),
      ]),
      urgency: "later",
      why: `Pay and gig earnings of about ${formatCents(year.earnedCents)} a year at your deposits' pace${year.stipendCents > 0 ? `, with ${formatCents(year.stipendCents)} of fellowship in income (it isn't earned income for this credit, IRS Pub. 596)` : ""}, put the earned income credit for someone without children at about ${formatCents(credit)}: up to ${formatWholeDollars(EITC.maxCredit[0])}, shrinking to nothing at ${formatWholeDollars(end)} of income. It's paid even with no tax owed. It's for ages 25 to 64 at the year's end, a US citizen or resident all year with a valid Social Security number, not someone else's dependent, with no more than ${formatWholeDollars(EITC.investmentIncomeLimit)} of interest and other unearned income (IRS).`,
      action: { label: "See your taxes", href: "/taxes" },
      more: [{ label: "IRS: who qualifies for the EITC", href: SOURCES.eitcWho.url }],
    });
  },
};

// Rent paid in California, off campus: the state's renter's credit.
const caRentersCredit: Detector = {
  capability: "taxes",
  topic: "ca_renters_credit",
  covers: ["tax_savings"],
  needs: ["home_state", "claimed_as_dependent"],
  detect({ profile, data }): Suggestion | null {
    const { facts } = profile;
    // Not tied to a visa: the FTB's conditions (rent in California for half the year, income, not
    // tax-exempt, not someone's dependent) name none, and a part-year resident files a Form 540NR
    // with a line for it (checked 2026-11-27). A federal nonresident can be a California resident.
    if (facts.home_state.value !== "CA") return null;
    const money = studentMoney(data);
    // Rent paid before a move into California was paid somewhere else: only the months from the
    // move count, never the months of another state's rent labelled California's.
    const moved = stateMove(
      data.transactions.filter((t) => t.date.startsWith(data.today.slice(0, 4))),
    );
    const sinceMove = moved?.to === "CA" ? `${moved.month}-01` : "";
    const rent = money.rent.filter((t) => !money.campusRent.includes(t) && t.date >= sinceMove);
    if (rent.length === 0) return null;
    const status = filingStatusOf(facts);
    const year = studentYearOf(data, facts, rateMonthsOf(profile));
    const limit = CA_RENTERS_CREDIT.incomeLimitCents[status];
    if (year.agiCents > limit) return null;
    const credit = CA_RENTERS_CREDIT.creditCents[status];
    const months = new Set(rent.map((t) => t.date.slice(0, 7))).size;
    return suggestion("taxes", "ca_renters_credit", {
      title: `California's renter's credit can be ${formatWholeDollars(credit)} at your income; FTB's rules decide it`,
      headline: headlineOf("Check California's renter's credit", credit, "saves"),
      short: `Rent paid in California, income under ${formatWholeDollars(limit)}: the credit can be ${formatWholeDollars(credit)}; FTB's rules decide it.`,
      worthCents: credit,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(facts.home_state),
        evidence("seen", profile.months, rent.length, "rent payments"),
        months >= CA_RENTERS_CREDIT.minMonths
          ? { percent: 90, reason: `rent in ${months} months` }
          : notSaid(
              55,
              `rent seen in ${months} month${months === 1 ? "" : "s"}; it needs half the year`,
            ),
      ]),
      urgency: "later",
      why: `You paid rent to ${nameOf(rent[0]).replace(/\s+Rent.*$/i, "")} in ${span(profile)}, and ${incomeYearOf(data)} income near ${formatCents(year.agiCents)} is under the ${formatWholeDollars(limit)} limit (the ${CA_RENTERS_CREDIT.limitsYear} return's; 2026's is set later and indexed up). California takes ${formatWholeDollars(credit)} off state income tax for someone who rented in California at least half the year, in a place that isn't exempt from property tax (campus housing usually is), and didn't live with someone who has them as a dependent (FTB). It lowers California tax owed and isn't paid beyond it.`,
      action: { label: "See your taxes", href: "/taxes" },
      more: [{ label: "FTB: renter's credit", href: SOURCES.ftbRenters.url }],
    });
  },
};

export const STUDENT_CREDIT_DETECTORS: readonly Detector[] = [
  educationCredit,
  studentLoanInterest,
  earnedIncomeCreditCard,
  caRentersCredit,
];
