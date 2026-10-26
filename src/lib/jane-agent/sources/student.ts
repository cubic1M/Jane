import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { STUDENT_STEPS } from "@/config/student-loans";
import { formatCents } from "@/lib/money";
import { PLAN_NAMES } from "@/planning/student-loans";
import { STUDENT_PAGE, stepMessage } from "../student-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Student loans (spec step 114). With a federal student loan, Jane walks the person through
// studentaid.gov's steps in one message (each with its official page), and in demo advice
// mode says which plan it'd pick when it costs less than the one they're on. Each once.

export const studentSource: MessageSource = {
  key: "student",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.student;
    if (!data?.loan || !data.comparison) return [];
    const out: Candidate[] = [];
    const pick = data.comparison.pick;
    const now = data.comparison.results.find((r) => r.plan === "current");
    const best = pick && data.comparison.results.find((r) => r.plan === pick.plan);
    if (pick && best && now && best.totalPaidCents < now.totalPaidCents) {
      out.push({
        kind: "decision",
        body: [
          `I compared the federal plans for your ${data.loan.name}. I'd look at ${PLAN_NAMES[pick.plan]}: ${formatCents(best.monthlyNowCents)} a month instead of ${formatCents(now.monthlyNowCents)}.`,
          ...pick.why,
          "Switching plans is done on studentaid.gov; I'll walk you through it.",
        ].join("\n"),
        refs: { advice: true },
        actions: [STUDENT_PAGE, snoozeButton()],
        dedupeKey: `pick:${pick.plan}`,
        priority: MESSAGE_PRIORITY.student_pick,
      });
    }
    if (data.profile.stepsDone < STUDENT_STEPS.length) {
      const step = stepMessage(data.profile.stepsDone);
      out.push({
        kind: "decision",
        body: step.body,
        refs: step.refs,
        actions: [...step.actions, snoozeButton()],
        dedupeKey: "steps",
        priority: MESSAGE_PRIORITY.student_steps,
      });
    }
    return out;
  },
};
