import {
  CREDIT_PAYMENT_WORDS,
  CREDIT_START,
  MONTHLY_FEE_SEEN_DAYS,
  MONTHLY_FEE_WORDS,
  STUDENT_ACCOUNTS,
} from "@/config/student-money";
import { addDays, daysBetween } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { formatCents, formatWholeDollars } from "@/lib/money";
import type { Profile, ProfileInput, ProfileTx } from "@/profile/build";
import { type Detector, suggestion } from "./contract";
import { evidence, factEvidence, headlineOf, weakest } from "./helpers";

// A young person's credit and checking (suggest-money lane, 11-18): no card or loan seen, so no
// credit file may be building, with how one starts and what each way costs; and a checking fee
// that the same bank's account for young owners doesn't charge. Facts from the CFPB and each
// bank's own page (src/config/student-money.ts); no product is picked over another bank's. Pure;
// see ./contract.ts.

const lineOf = (t: ProfileTx) => `${t.merchantName ?? ""} ${t.description}`.toUpperCase();

// The person's age, when known: told, or the age the profile holds.
function ageOf(profile: Profile): number | null {
  const age = profile.facts.age.value;
  return typeof age === "number" ? age : null;
}

// Young enough for these to matter: a student, or under 30 by what's known.
function young(profile: Profile): boolean {
  const age = ageOf(profile);
  if (age !== null) return age < 30;
  return (
    profile.facts.is_student.value === true ||
    profile.facts.age_band.value === "under_30" ||
    profile.facts.life_stage.value === "starting"
  );
}

// Days of data: the first line to today.
const daysOfData = (data: ProfileInput) => {
  const first = data.transactions.reduce((m, t) => (t.date < m ? t.date : m), data.today);
  return daysBetween(first, data.today);
};

const creditFileStart: Detector = {
  capability: "debt",
  topic: "credit_file_start",
  covers: ["credit_building"],
  needs: ["is_student"],
  detect({ profile, data }) {
    if (!young(profile)) return null;
    const days = daysOfData(data);
    if (days < CREDIT_START.minDays) return null;
    // Only cash accounts, no loan on file, and nothing paid to a card or lender.
    if (data.accounts.length === 0 || data.accounts.some((a) => a.type !== "depository"))
      return null;
    if (data.liabilities.length > 0) return null;
    const paid = data.transactions.some(
      (t) =>
        t.amountCents > 0 &&
        ((t.pfc ?? "").startsWith("LOAN_PAYMENTS") ||
          t.pfc === "BANK_FEES_INTEREST_CHARGE" ||
          CREDIT_PAYMENT_WORDS.test(lineOf(t))),
    );
    if (paid) return null;
    const c = CREDIT_START;
    const span = profile.months >= 2 ? `${profile.months} months` : `${days} days`;
    return suggestion("debt", "credit_file_start", {
      title: "Start a credit file: no card or loan shows in your accounts",
      headline: "Start building your credit file",
      short: `No card or loan payment in ${span} of your accounts, so no credit history may be building.`,
      worthCents: 0,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, 0, "card or loan payments"),
        // Jane can't see a credit report: a card at another bank paid from elsewhere is possible.
        { percent: 60, reason: "I can't see your credit report, only these accounts" },
        ...(profile.facts.is_student.value === true
          ? [factEvidence(profile.facts.is_student)]
          : []),
      ]),
      urgency: "later",
      why: `In ${span} of your accounts there's no credit card, no loan and no payment to one, so no credit history may be building; landlords, phone companies and lenders read that history. Ways a file starts, with what each costs, as the CFPB lists them: a secured card, where you deposit ${formatWholeDollars(c.securedDepositCents.from)} to ${formatWholeDollars(c.securedDepositCents.to)} that becomes your credit line (ask whether the card reports to the credit bureaus); or a credit-builder loan, usually at a credit union, where ${formatWholeDollars(c.builderLoanCents.from)} to ${formatWholeDollars(c.builderLoanCents.to)} is held in a locked savings account while you repay it over ${c.builderLoanMonths.from} to ${c.builderLoanMonths.to} months, and it comes back to you at the end. Paying on time and using little of a limit are what count. Your credit report is free at annualcreditreport.com, so you can see whether a file exists.`,
      action: { label: "See how credit is built", href: "/loans/credit" },
      more: [
        { label: "CFPB: building credit from scratch", href: c.url },
        { label: "Your free credit report", href: c.reportUrl },
      ],
    });
  },
};

// A checking account's monthly fee, at a bank whose account for young owners doesn't charge one.
const studentChecking: Detector = {
  capability: "cost",
  topic: "student_checking",
  covers: [],
  needs: ["is_student"],
  detect({ profile, data }) {
    const student = profile.facts.is_student;
    if (student.value !== true) return null;
    const since = addDays(data.today, -MONTHLY_FEE_SEEN_DAYS);
    for (const offer of STUDENT_ACCOUNTS) {
      const age = ageOf(profile);
      if (age !== null && (age < offer.ages.from || age > offer.ages.to)) continue;
      const accounts = data.accounts.filter(
        (a) =>
          a.type === "depository" &&
          offer.words.test(`${a.institution ?? ""} ${a.name ?? ""}`.toUpperCase()),
      );
      const ids = new Set(accounts.map((a) => a.id));
      const fees = data.transactions
        .filter(
          (t) =>
            ids.has(t.accountId) &&
            t.amountCents > 0 &&
            t.date >= since &&
            t.date <= data.today &&
            (t.pfc ?? "").startsWith("BANK_FEES") &&
            MONTHLY_FEE_WORDS.test(lineOf(t)),
        )
        .sort((a, b) => b.date.localeCompare(a.date));
      const latest = fees[0];
      if (!latest) continue;
      const overdraft = data.transactions.filter(
        (t) =>
          ids.has(t.accountId) &&
          t.amountCents > 0 &&
          (t.pfc === "BANK_FEES_OVERDRAFT_FEES" || t.pfc === "BANK_FEES_INSUFFICIENT_FUNDS"),
      );
      const yearly = latest.amountCents * 12;
      const overdrawn = offer.noOverdraftFees && overdraft.length > 0;
      return suggestion("cost", "student_checking", {
        title: `${offer.bank} has ${offer.account}: ${offer.rule}`,
        headline: headlineOf(`Look at ${offer.bank}'s no-fee account`, yearly, "saves"),
        short: `${offer.bank} charged you a ${formatCents(latest.amountCents)} monthly fee on ${dayLabel(latest.date)}.`,
        worthCents: yearly,
        worthKind: "saves",
        confidence: weakest([
          factEvidence(student),
          evidence("seen", profile.months, fees.length, "monthly fees"),
          // Jane doesn't know the person's age from the bank: the rule turns on it.
          ...(age === null
            ? [
                {
                  percent: 65,
                  reason: `${offer.bank}'s rule turns on your age, which I don't know`,
                },
              ]
            : []),
        ]),
        urgency: "soon",
        why: `Your ${offer.bank} checking charged a ${formatCents(latest.amountCents)} monthly fee on ${dayLabel(latest.date, { long: true })}, about ${formatCents(yearly)} a year. ${offer.account} has ${offer.rule}, according to ${offer.bank}'s own page.${age === null ? " That turns on your age, which I don't have." : ""}${overdrawn ? ` You also paid ${overdraft.length} overdraft fee${overdraft.length === 1 ? "" : "s"} there.` : ""} Its page says how to open it.`,
        action: { label: `See ${offer.account}`, href: offer.url },
        watch: {
          kind: "fee_stops",
          pfcs: [latest.pfc ?? "BANK_FEES_OTHER_BANK_FEES"],
          monthlyCents: latest.amountCents,
        },
      });
    }
    return null;
  },
};

export const STUDENT_CREDIT_CASH_DETECTORS: readonly Detector[] = [
  creditFileStart,
  studentChecking,
];
