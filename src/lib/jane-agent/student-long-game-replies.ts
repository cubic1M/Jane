import { PSLF_PAYMENTS } from "@/config/student-loans";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { LongGame } from "@/lib/student-long-game";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about the long game on student loans (spec step 225), from
// src/lib/student-long-game.ts. Pure. The tax on forgiven debt is handed to the taxes side;
// refinancing a federal loan always says what's lost.

export const STUDENT_PAGE: MessageAction = {
  id: "open",
  label: "Your student loan plan",
  kind: "link",
  href: "/loans/student",
};

export const TAXES_PAGE: MessageAction = {
  id: "open",
  label: "Your taxes",
  kind: "link",
  href: "/taxes",
};

const unavailable: Reply = {
  body: "I don't see a student loan with a balance and a rate, so there's no long game to plan yet. Link the account or type in its terms on the debts page.",
  actions: [],
  refs: {},
};

export function longGameLines(g: LongGame): string[] {
  const lines: string[] = [];
  if (!g.pslf) {
    lines.push(
      "You haven't said you work in public service, so I'm not counting payments toward Public Service Loan Forgiveness.",
    );
  }
  if (g.pslf) {
    lines.push(
      g.pslf.remaining === 0
        ? `You've made all ${PSLF_PAYMENTS} qualifying payments: apply for Public Service Loan Forgiveness.`
        : `Public Service Loan Forgiveness: ${g.pslf.counted} of ${PSLF_PAYMENTS} qualifying payments counted, ${g.pslf.remaining} to go, forgiven around ${dayLabel(g.pslf.forgivenOn!, { year: true })} if you keep paying on time.`,
    );
  }
  if (g.certifyOn) {
    lines.push(
      `Certify your employer by ${dayLabel(g.certifyOn, { year: true })}; it's on your deadlines.`,
    );
  } else if (g.publicService) {
    lines.push(
      "Tell me when you last certified your employer and I'll put the next date on your deadlines.",
    );
  }
  if (g.recertifyOn) {
    lines.push(
      `Recertify your income-driven plan by ${dayLabel(g.recertifyOn, { year: true })}; it's on your deadlines.`,
    );
  }
  if (g.forgiveness && g.tax) {
    lines.push(
      g.tax.taxable
        ? `${formatCents(g.forgiveness.forgivenCents)} would be forgiven around ${dayLabel(g.forgiveness.on, { year: true })}. ${g.tax.note} At a 22% rate that's about ${formatCents(g.tax.estimateCents)}, an estimate. I'll put it on your deadlines two years before, for your tax plan.`
        : `${formatCents(g.forgiveness.forgivenCents)} would be forgiven around ${dayLabel(g.forgiveness.on, { year: true })}. ${g.tax.note}`,
    );
  }
  if (g.refi) {
    lines.push(g.refi.verdict === "consider" ? g.refi.text : `On refinancing: ${g.refi.text}`);
  }
  return lines;
}

export function longGameReply(g: LongGame): Reply {
  if (!g.available) return unavailable;
  const lines = longGameLines(g);
  if (lines.length === 0) {
    lines.push(
      "Add your dates on the student loan page and I'll track certification, recertification and forgiveness for you.",
    );
  }
  return {
    body: lines.join("\n"),
    actions: g.tax?.taxable ? [STUDENT_PAGE, TAXES_PAGE] : [STUDENT_PAGE],
    refs: g.advice ? { advice: true } : {},
  };
}
