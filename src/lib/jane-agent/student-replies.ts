import { STUDENT_STEPS } from "@/config/student-loans";
import { formatCents } from "@/lib/money";
import type { StudentLoans } from "@/lib/student-loans";
import { PLAN_NAMES } from "@/planning/student-loans";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";
import { formatRate } from "@/lib/percent";

// Jane's answers about student loans (spec step 114). Pure. Plan payments are the federal
// plans' rules (src/config/student-loans.ts); the pick is demo advice, labelled. Every
// studentaid.gov step links to its official page.

export const STUDENT_PAGE: MessageAction = {
  id: "open",
  label: "See student loan plans",
  kind: "link",
  href: "/loans/student",
};

// The guided step after `done` steps, as a message with its official link and "Done".
export function stepMessage(done: number): Reply {
  const step = STUDENT_STEPS[done];
  if (!step) {
    return {
      body: "That's every step on studentaid.gov done. Recertify your income each year to keep an income-driven payment right; I'll keep counting your payments.",
      actions: [STUDENT_PAGE],
      refs: {},
    };
  }
  return {
    body: `Student loans, step ${done + 1} of ${STUDENT_STEPS.length}: ${step.title}.\n${step.does}`,
    actions: [
      { id: "open", label: "Open it on studentaid.gov", kind: "link", href: step.url },
      { id: "student.next", label: "Done, next step", kind: "primary" },
      STUDENT_PAGE,
    ],
    refs: {},
  };
}

export function studentReply(data: StudentLoans): Reply {
  if (!data.loan) {
    return {
      body: "I don't see a federal student loan with a balance and rate. If you have one, link the servicer's account or add its rate on the loans page.",
      actions: [{ id: "open", label: "See every debt", kind: "link", href: "/loans" }],
      refs: {},
    };
  }
  const { loan, comparison } = data;
  const lines = [
    `Your ${loan.name}: ${formatCents(loan.balanceCents!)} at ${formatRate(loan.aprBps!)}. At ${data.agiFrom === "you" ? "the income you gave" : "an income estimated from your paychecks"} (${formatCents(data.agiCents)} a year):`,
    ...comparison!.results.map(
      (r) =>
        `- ${PLAN_NAMES[r.plan]}: ${formatCents(r.monthlyNowCents)} a month, ${formatCents(r.totalPaidCents)} in all${r.forgivenCents > 0 ? `, ${formatCents(r.forgivenCents)} forgiven${r.viaPslf ? " through PSLF" : ""}` : ""}`,
    ),
  ];
  if (comparison!.pick) {
    lines.push(`I'd pick ${PLAN_NAMES[comparison!.pick.plan]}.`, ...comparison!.pick.why);
  } else {
    lines.push("This is math, not a recommendation.");
  }
  lines.push(
    `Forgiveness: ${data.paymentsCounted} of ${data.countingToward.needed} qualifying payments counted toward ${data.countingToward.name}${data.paymentsSeen > 0 ? ` (${data.paymentsSeen} I've seen you make)` : ""}.`,
  );
  const next = STUDENT_STEPS[data.profile.stepsDone];
  if (next) lines.push(`Next on studentaid.gov: ${next.title}.`);
  return {
    body: lines.join("\n"),
    actions: [
      ...(next
        ? [{ id: "open" as const, label: next.title, kind: "link" as const, href: next.url }]
        : []),
      STUDENT_PAGE,
    ],
    refs: comparison!.pick ? { advice: true } : {},
  };
}
