import { connectorsOn } from "@/config/connectors";
import { FED_AUTOPAY, SAVE_ENDING, STUDENT_STEPS } from "@/config/student-loans";
import { formatCents } from "@/lib/money";
import { levelPaymentCents } from "@/planning/refinance";
import { confidenceOf } from "@/profile/confidence";
import type { ProfileLiability } from "@/profile/build";
import { type Detector, suggestionId } from "./contract";
import { headlineOf } from "./helpers";

// Federal student loans (connectors roadmap round 15, the student_aid connector's cards). Behind
// CONNECTORS while the connectors phase is off in production. Pure apart from reading that flag;
// see ./contract.ts.

const DAY = 86_400_000;

// A federal Direct Loan, as the bank reports it: its name is a Direct Loan's ("Direct
// Unsubsidized", "Direct PLUS", "Direct Consolidation"), not just any name with "direct" in it (a
// private "direct to consumer" loan), or it's on a plan only federal loans have.
const DIRECT_NAME =
  /\bdirect\s+(sub|subsidized|unsub|unsubsidized|plus|grad plus|parent plus|consolidation|consolidated|stafford|loan)\b/i;

export function federalDirect(l: ProfileLiability): boolean {
  if (l.kind !== "student") return false;
  if (DIRECT_NAME.test(l.description ?? "")) return true;
  return (FED_AUTOPAY.federalPlans as readonly string[]).includes(l.repaymentPlan ?? "");
}

// Old enough to miss the cut: first disbursed before July 1, 2012. Unknown counts as maybe.
const tooOld = (l: ProfileLiability) =>
  !!l.originationDate && l.originationDate < FED_AUTOPAY.disbursedFrom;

// Being repaid now, as far as the bank says: no status counts, a stopped one doesn't.
const repaying = (l: ProfileLiability) =>
  !(FED_AUTOPAY.stoppedStatuses as readonly string[]).includes(l.loanStatus ?? "");

const daysTo = (today: string, day: string) =>
  Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);

// The autopay rate cut: 1% off a federal Direct Loan's rate through June 2028 for anyone enrolled
// by December 31, 2026. Jane can't see whether autopay is on, so it asks the person to check, and
// says nothing once the day has passed.
const studentAutopay: Detector = {
  capability: "debt",
  topic: "student_autopay",
  covers: ["student_loans"],
  needs: [],
  detect({ profile, data }) {
    if (!connectorsOn()) return null;
    const left = daysTo(data.today, FED_AUTOPAY.lastDay);
    if (left < 0) return null;
    const loans = data.liabilities.filter((l) => federalDirect(l) && repaying(l) && !tooOld(l));
    if (loans.length === 0) return null;
    const owed = loans
      .map((l) => data.accounts.find((a) => a.id === l.accountId)?.balanceCents ?? 0)
      .reduce((sum, cents) => sum + Math.abs(cents), 0);
    if (owed <= 0) return null;
    const yearly = Math.round((owed * FED_AUTOPAY.cutBps) / 10_000);
    const deadline = new Date(`${FED_AUTOPAY.lastDay}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const see = STUDENT_STEPS.find((s) => s.key === "see_loans")!;
    // What Jane can't tell from the bank: when a loan was first paid out, and whether it's on RAP
    // (no Plaid name yet: "unknown" or "other"), where unpaid interest is waived anyway.
    const undated = loans.some((l) => !l.originationDate);
    const maybeRap = loans.some(
      (l) => l.repaymentPlan === "unknown" || l.repaymentPlan === "other",
    );
    return {
      id: suggestionId("debt", "student_autopay"),
      capability: "debt",
      topic: "student_autopay",
      title: `Make sure autopay is on for your federal student loans by ${deadline}`,
      headline: headlineOf("Turn on student loan autopay", yearly, "saves"),
      short: `Autopay by ${deadline} takes 1% off the rate on ${formatCents(owed)} owed.`,
      worthCents: yearly,
      worthKind: "saves",
      confidence: {
        percent: confidenceOf("guessed", { months: profile.months, matches: loans.length }),
        reason: "your bank reports a federal loan being repaid; I can't see whether autopay is on",
      },
      urgency: left <= FED_AUTOPAY.urgentDays ? "now" : "soon",
      why: `Federal Direct Loans get 1% off their rate through June 30, 2028 for anyone signed up for autopay with their servicer by 11:59 p.m. Eastern on ${deadline}. On your ${formatCents(owed)} that's about ${formatCents(yearly)} a year${undated ? ", if your loans were first paid out after July 1, 2012" : ""}. Forbearance or deferment ends it.${maybeRap ? " On RAP it can save less, since unpaid interest is waived there." : ""} If autopay is already on, nothing to do.`,
      action: { label: "See your loans and servicer", href: "/loans/student" },
      more: [{ label: see.title, href: see.url }],
    };
  },
};

// SAVE has ended: each borrower has 90 days from their own notice to pick a plan, or is put on
// Standard. Worth what Standard would add to the payment in a year: the risk of not choosing.
const saveEnding: Detector = {
  capability: "debt",
  topic: "student_save_ending",
  covers: ["student_loans"],
  needs: [],
  detect({ profile, data }) {
    if (!connectorsOn()) return null;
    const loans = data.liabilities.filter(
      (l) =>
        l.kind === "student" &&
        (SAVE_ENDING.plans as readonly string[]).includes(l.repaymentPlan ?? "") &&
        !(SAVE_ENDING.doneStatuses as readonly string[]).includes(l.loanStatus ?? ""),
    );
    let owed = 0;
    let standard = 0;
    let now = 0;
    for (const l of loans) {
      const balance = Math.abs(data.accounts.find((a) => a.id === l.accountId)?.balanceCents ?? 0);
      if (balance <= 0 || l.aprBps === null) continue;
      owed += balance;
      standard += levelPaymentCents(balance, l.aprBps, SAVE_ENDING.standardMonths);
      now += l.minimumCents ?? 0;
    }
    const rise = standard - now;
    if (owed <= 0 || rise <= 0) return null;
    const simulate = STUDENT_STEPS.find((s) => s.key === "simulate")!;
    return {
      id: suggestionId("debt", "student_save_ending"),
      capability: "debt",
      topic: "student_save_ending",
      title: "Pick a new repayment plan now that SAVE has ended",
      headline: "Pick a new student loan plan",
      short: `SAVE has ended: without a choice, Standard is about ${formatCents(standard)} a month.`,
      worthCents: rise * 12,
      worthKind: "risk",
      confidence: {
        percent: confidenceOf("guessed", { months: profile.months, matches: loans.length }),
        reason: "your bank reports a loan on SAVE; I can't see your notice's date",
      },
      urgency: "now",
      why: `Your bank still shows ${formatCents(owed)} on SAVE, which has ended. You have ${SAVE_ENDING.chooseDays} days from your notice to pick a plan, or you're put on Standard: about ${formatCents(standard)} a month, ${formatCents(rise)} more than now. Compare RAP, IBR and Standard first. Consolidating now leaves only RAP and Tiered Standard.`,
      action: { label: "Compare repayment plans", href: "/loans/student" },
      more: [{ label: simulate.title, href: simulate.url }],
    };
  },
};

export const STUDENT_AID_DETECTORS: readonly Detector[] = [studentAutopay, saveEnding];
