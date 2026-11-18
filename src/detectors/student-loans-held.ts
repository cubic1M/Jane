import { GRACE_ENDING } from "@/config/student-money";
import { STUDENT_STEPS } from "@/config/student-loans";
import { daysBetween } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { formatRate } from "@/lib/percent";
import { levelPaymentCents } from "@/planning/refinance";
import { type Detector, suggestion } from "./contract";
import { evidence } from "./helpers";

// Student loans already held (suggest-money lane, 11-18): a grace period ending, so the first
// payments are planned before they're due. Facts from the bank's loan record and studentaid.gov;
// no plan is picked. Pure; see ./contract.ts.

const graceEnding: Detector = {
  capability: "debt",
  topic: "grace_ending",
  covers: ["student_loans"],
  needs: [],
  detect({ profile, data }) {
    const loans = data.liabilities.flatMap((l) => {
      if (l.kind !== "student" || l.loanStatus !== "in grace" || !l.loanStatusEndDate) return [];
      const left = daysBetween(data.today, l.loanStatusEndDate);
      if (left < 0 || left > GRACE_ENDING.aheadDays) return [];
      const owed = Math.abs(data.accounts.find((a) => a.id === l.accountId)?.balanceCents ?? 0);
      return owed > 0 ? [{ l, owed, ends: l.loanStatusEndDate }] : [];
    });
    if (loans.length === 0) return null;
    const ends = loans.map((x) => x.ends).sort()[0]!;
    const owed = loans.reduce((n, x) => n + x.owed, 0);
    const rated = loans.filter((x) => typeof x.l.aprBps === "number" && x.l.aprBps > 0);
    const monthly =
      rated.length === loans.length
        ? rated.reduce(
            (n, x) => n + levelPaymentCents(x.owed, x.l.aprBps!, GRACE_ENDING.standardMonths),
            0,
          )
        : null;
    const left = daysBetween(data.today, ends);
    const simulate = STUDENT_STEPS.find((s) => s.key === "simulate")!;
    const see = STUDENT_STEPS.find((s) => s.key === "see_loans")!;
    const rates = [...new Set(rated.map((x) => formatRate(x.l.aprBps!)))].join(" and ");
    return suggestion("debt", "grace_ending", {
      title: `Plan your student loan payments: the grace period ends ${dayLabel(ends, { long: true, year: true })}`,
      headline: "Plan your first student loan payments",
      short: `Grace ends ${dayLabel(ends)} on ${formatCents(owed)}${monthly ? `; Standard is about ${formatCents(monthly)} a month` : ""}.`,
      worthCents: 0,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, loans.length, "loans in grace"),
      urgency: left <= GRACE_ENDING.urgentDays ? "now" : "soon",
      why: `Your bank reports ${formatCents(owed)} in student loans in their grace period until ${dayLabel(ends, { long: true, year: true })}${rates ? `, at ${rates}` : ""}; repayment starts after it, and your servicer sends the first due date.${monthly ? ` On the Standard plan (ten years of level payments) that's about ${formatCents(monthly)} a month.` : ""} Before then: sign in to studentaid.gov to see each loan and its servicer, compare each plan's payment in the Loan Simulator, and set up the payment from your bank with your servicer so the first one isn't missed.`,
      action: { label: "See your loans and servicer", href: "/loans/student" },
      more: [
        { label: simulate.title, href: simulate.url },
        { label: see.title, href: see.url },
        { label: "studentaid.gov: the grace period", href: GRACE_ENDING.url },
      ],
    });
  },
};

export const STUDENT_LOANS_HELD_DETECTORS: readonly Detector[] = [graceEnding];
