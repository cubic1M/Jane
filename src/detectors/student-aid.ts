import { BILLERS } from "@/config/billers";
import { PAID_LOAN_MIN_PAYMENTS, PAID_LOAN_RECENT_DAYS } from "@/config/debt";
import {
  AUTOPAY_WORDS,
  FED_AUTOPAY,
  FEDERAL_PAYMENT_WORDS,
  SAVE_ENDING,
  STUDENT_STEPS,
} from "@/config/student-loans";
import { addDays } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { levelPaymentCents } from "@/planning/refinance";
import { confidenceOf } from "@/profile/confidence";
import type { ProfileLiability } from "@/profile/build";
import { type Detector, suggestion } from "./contract";
import { headlineOf } from "./helpers";
import { dayLabel } from "@/lib/day-label";

// Federal student loans (connectors roadmap round 15, the student_aid connector's cards). Facts
// and a studentaid.gov link, no partner and no advice, so they show on real accounts with the
// connectors phase off (manager, 11-06: the autopay cut ends December 31). Pure; see ./contract.ts.

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

// Federal servicers and private lenders, as a payment line names them (billers.ts).
const STUDENT_BILLERS = BILLERS.filter((b) => b.type === "student_loan");
const FEDERAL_SERVICERS = STUDENT_BILLERS.filter((b) => b.biller.endsWith("(federal)")).map(
  (b) => ({
    name: b.biller.replace(/\s*\(federal\)$/, ""),
    words: b.matchTokens,
    url: b.payUrl,
  }),
);
const PRIVATE_WORDS = STUDENT_BILLERS.filter((b) => !b.biller.endsWith("(federal)")).flatMap(
  (b) => b.matchTokens,
);

export type ServicerPaid = { name: string | null; url: string | null; payments: number };

// Still time to enrol: December 31, 2026 or before, in the person's own day.
export const autopayStillOpen = (today: string) => daysTo(today, FED_AUTOPAY.lastDay) >= 0;

// With no loan account on file (an upload person's usual case), what their statement shows: a
// federal servicer paid at least twice lately, not on autopay as far as the line says, and never a
// private lender's line (debugger 11-16: a student paying Nelnet saw no autopay card at all).
export function servicersPaid(data: Parameters<Detector["detect"]>[0]["data"]): ServicerPaid[] {
  const since = addDays(data.today, -PAID_LOAN_RECENT_DAYS);
  const found = new Map<string, ServicerPaid & { autopay: boolean; last: string }>();
  for (const t of data.transactions) {
    if (t.amountCents <= 0 || t.date > data.today) continue;
    const line = `${t.merchantName ?? ""} ${t.description}`.toUpperCase();
    if (PRIVATE_WORDS.some((w) => line.includes(w))) continue;
    const servicer = FEDERAL_SERVICERS.find((s) => s.words.some((w) => line.includes(w)));
    if (!servicer && !FEDERAL_PAYMENT_WORDS.some((w) => line.includes(w))) continue;
    const key = servicer?.name ?? "federal";
    const seen = found.get(key) ?? {
      name: servicer?.name ?? null,
      url: servicer?.url ?? null,
      payments: 0,
      autopay: false,
      last: "",
    };
    seen.payments += 1;
    seen.autopay ||= AUTOPAY_WORDS.test(line);
    if (t.date > seen.last) seen.last = t.date;
    found.set(key, seen);
  }
  return [...found.values()]
    .filter((s) => s.payments >= PAID_LOAN_MIN_PAYMENTS && s.last >= since && !s.autopay)
    .map(({ name, url, payments }) => ({ name, url, payments }));
}

// The autopay rate cut: 1% off a federal Direct Loan's rate through June 2028 for anyone enrolled
// by December 31, 2026. Jane can't see whether autopay is on, so it asks the person to check, and
// says nothing once the day has passed.
const studentAutopay: Detector = {
  capability: "debt",
  topic: "student_autopay",
  covers: ["student_loans"],
  needs: [],
  detect({ profile, data }) {
    const left = daysTo(data.today, FED_AUTOPAY.lastDay);
    if (left < 0) return null;
    // A loan account on file says more than a payment line does: only without one.
    if (!data.liabilities.some((l) => l.kind === "student"))
      return fromPayments(profile, data, left);
    const loans = data.liabilities.filter((l) => federalDirect(l) && repaying(l) && !tooOld(l));
    if (loans.length === 0) return null;
    const owed = loans
      .map((l) => data.accounts.find((a) => a.id === l.accountId)?.balanceCents ?? 0)
      .reduce((sum, cents) => sum + Math.abs(cents), 0);
    if (owed <= 0) return null;
    const yearly = Math.round((owed * FED_AUTOPAY.cutBps) / 10_000);
    const deadline = dayLabel(FED_AUTOPAY.lastDay, { long: true, year: true });
    const see = STUDENT_STEPS.find((s) => s.key === "see_loans")!;
    // What Jane can't tell from the bank: when a loan was first paid out, and whether it's on RAP
    // (no Plaid name yet: "unknown" or "other"), where unpaid interest is waived anyway.
    const undated = loans.some((l) => !l.originationDate);
    const maybeRap = loans.some(
      (l) => l.repaymentPlan === "unknown" || l.repaymentPlan === "other",
    );
    return suggestion("debt", "student_autopay", {
      title: `Make sure autopay is on for your federal student loans by ${deadline}`,
      // Without a date Jane can't say the loan gets the cut, so no figure in the headline.
      headline: undated
        ? "Turn on student loan autopay"
        : headlineOf("Turn on student loan autopay", yearly, "saves"),
      short: `Autopay by ${deadline} takes 1% off the rate on ${formatCents(owed)} owed.`,
      worthCents: yearly,
      worthKind: "saves",
      confidence: {
        percent: confidenceOf("guessed", { months: profile.months, matches: loans.length }),
        reason: "your bank reports a federal loan being repaid; I can't see whether autopay is on",
      },
      urgency: left <= FED_AUTOPAY.urgentDays ? "now" : "soon",
      why: `Federal Direct Loans get 1% off their rate through June 30, 2028 for anyone signed up for autopay with their servicer by 11:59 p.m. Eastern on ${deadline}. On your ${formatCents(owed)} that's about ${formatCents(yearly)} a year${undated ? ", if your loans were first paid out after July 1, 2012" : ""}. Deferment or forbearance pauses it, and three payments returned in a row end it.${maybeRap ? " On RAP it can save less, since unpaid interest is waived there." : ""} If autopay is already on, nothing to do.`,
      action: { label: "See your loans and servicer", href: "/loans/student" },
      more: [{ label: see.title, href: see.url }],
    });
  },
};

// The same card from the statement alone: what's owed isn't known, so the saving is the rate
// cut itself, and the steps are the servicer's own page (Jane can't turn autopay on).
function fromPayments(
  profile: Parameters<Detector["detect"]>[0]["profile"],
  data: Parameters<Detector["detect"]>[0]["data"],
  left: number,
) {
  const paid = servicersPaid(data);
  if (paid.length === 0) return null;
  const deadline = dayLabel(FED_AUTOPAY.lastDay, { long: true, year: true });
  const see = STUDENT_STEPS.find((s) => s.key === "see_loans")!;
  const named = paid.filter((p) => p.name);
  const who = named.length > 0 ? named.map((p) => p.name).join(" and ") : "your loan servicer";
  return suggestion("debt", "student_autopay", {
    title: `Make sure autopay is on for your federal student loans by ${deadline}`,
    headline: "Turn on student loan autopay",
    short: `Autopay with ${who} by ${deadline} takes 1% off a federal loan's rate.`,
    // What's owed isn't on file: no figure rather than a guessed one.
    worthCents: 0,
    worthKind: "saves",
    confidence: {
      percent: confidenceOf("guessed", {
        months: profile.months,
        matches: paid.reduce((n, p) => n + p.payments, 0),
      }),
      reason: `you pay ${who} from checking; I can't see the loans, or whether autopay is on`,
    },
    urgency: left <= FED_AUTOPAY.urgentDays ? "now" : "soon",
    why: `You pay ${who}, a federal student loan servicer. Federal Direct Loans first paid out after July 1, 2012 get 1% off their rate through June 30, 2028 for anyone signed up for autopay with their servicer by 11:59 p.m. Eastern on ${deadline}: about $10 a year for every $1,000 owed. To do it: sign in at ${who}'s site, turn on Auto Pay from your checking account, and check it shows as on. Private loans ${named.some((p) => p.name === "MOHELA") ? "(MOHELA also services some) " : ""}don't get this cut. If autopay is already on, nothing to do.`,
    action: { label: "See your loans and servicer", href: "/loans/student" },
    more: [
      ...named.flatMap((p) => (p.url ? [{ label: `Sign in to ${p.name}`, href: p.url }] : [])),
      { label: see.title, href: see.url },
    ],
  });
}

// Standard's term: ten years, or for a Direct Consolidation Loan a term set by what's owed.
function standardMonths(l: ProfileLiability, balanceCents: number): number {
  if (!/\bconsolidat/i.test(l.description ?? "")) return SAVE_ENDING.standardMonths;
  return SAVE_ENDING.consolidationMonths.find((t) => balanceCents < t.underCents)!.months;
}

// SAVE has ended: each borrower has 90 days from their own notice to pick a plan, or is put on
// Standard. Worth what Standard would add to the payment in a year: the risk of not choosing.
const saveEnding: Detector = {
  capability: "debt",
  topic: "student_save_ending",
  covers: ["student_loans"],
  needs: [],
  detect({ profile, data }) {
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
      standard += levelPaymentCents(balance, l.aprBps, standardMonths(l, balance));
      now += l.minimumCents ?? 0;
    }
    const rise = standard - now;
    if (owed <= 0 || rise <= 0) return null;
    const simulate = STUDENT_STEPS.find((s) => s.key === "simulate")!;
    return suggestion("debt", "student_save_ending", {
      title: "Pick a new repayment plan now that SAVE has ended",
      headline: "Pick a new student loan plan",
      short: `SAVE has ended: without a choice, Standard could be about ${formatCents(standard)} a month.`,
      worthCents: rise * 12,
      worthKind: "risk",
      confidence: {
        percent: confidenceOf("guessed", { months: profile.months, matches: loans.length }),
        reason: "your bank reports a loan on SAVE; I can't see your notice's date",
      },
      urgency: "now",
      why: `Your bank still shows ${formatCents(owed)} on SAVE, which has ended. You have ${SAVE_ENDING.chooseDays} days from your notice to pick a plan, or you're put on Standard or Tiered Standard. Standard would be about ${formatCents(standard)} a month, ${formatCents(rise)} more than now. Compare RAP, IBR and Standard first. Consolidating now leaves only RAP and Tiered Standard.`,
      action: { label: "Compare repayment plans", href: "/loans/student" },
      more: [{ label: simulate.title, href: simulate.url }],
    });
  },
};

export const STUDENT_AID_DETECTORS: readonly Detector[] = [studentAutopay, saveEnding];
