import { LOAN_APPROVED_REMIND_DAYS, LOAN_PAYOFF_WAIT_DAYS } from "@/config/debt";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatRate } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import type { Candidate, MessageAction } from "../types";
import type { MessageSource } from "./source";

// Loan applications (spec step 112): Jane follows each one on its own
// (src/lib/loan-applications.ts refreshLoanApplications) and says how it's going: an
// approved loan still waiting for the person's yes (a reminder, a day on), the lender
// funding it, the old loan reaching zero, and an old loan that still shows a balance well
// after funding. Each once.

const DAY_MS = 24 * 60 * 60 * 1000;
const open = (id: string): MessageAction => ({
  id: "open",
  label: "See the application",
  kind: "link",
  href: `/loans/apply/${id}`,
});

export const loansSource: MessageSource = {
  key: "loans",
  gather: (snapshot, { now }) =>
    (snapshot.loanApplications ?? []).flatMap((app): Candidate[] => {
      const days = (at: Date | null) => (at ? (now.getTime() - at.getTime()) / DAY_MS : 0);
      if (app.status === "approved" && days(app.submittedAt) >= LOAN_APPROVED_REMIND_DAYS) {
        return [
          {
            kind: "decision" as const,
            body: `${app.lender} approved your loan: ${formatRate(app.aprBps)} ${app.rateType} for ${app.termMonths} months, ${formatCents(app.monthlyCents)} a month, paying off your ${app.oldName}. It's waiting for your yes; nothing is signed until you accept.`,
            refs: { applicationId: app.id },
            actions: [
              { id: "loan.accept" as const, label: "Accept the loan", kind: "primary" as const },
              { id: "loan.withdraw" as const, label: "Don't take it", kind: "secondary" as const },
              open(app.id),
            ],
            dedupeKey: `approved:${app.id}`,
            priority: MESSAGE_PRIORITY.loan_approved,
          },
        ];
      }
      if (app.status === "funded") {
        const late = days(app.fundedAt) >= LOAN_PAYOFF_WAIT_DAYS;
        return [
          late
            ? {
                kind: "heads_up" as const,
                body: `${app.lender} funded your new loan ${Math.floor(days(app.fundedAt))} days ago, but your bank still shows a balance on your ${app.oldName}. Check with ${app.lender} that the payoff went through, and don't pay both.`,
                refs: { applicationId: app.id },
                actions: [open(app.id)],
                dedupeKey: `late:${app.id}`,
                priority: MESSAGE_PRIORITY.loan_payoff_late,
              }
            : {
                kind: "done" as const,
                body: `${app.lender} funded your new loan and is paying off your ${app.oldName}. I'm watching for your bank to show it at zero.`,
                refs: { applicationId: app.id },
                actions: [open(app.id)],
                dedupeKey: `funded:${app.id}`,
                priority: MESSAGE_PRIORITY.loan_funded,
              },
        ];
      }
      if (app.status === "paid_off") {
        return [
          {
            kind: "done" as const,
            body: `Your ${app.oldName} is paid off: your bank shows it at zero. Your new ${app.lender} loan is ${formatCents(app.monthlyCents)} a month at ${formatRate(app.aprBps)}, about ${formatCents(app.savingCents)} less than keeping the old one. I've added it to your debts.`,
            refs: { applicationId: app.id },
            actions: [
              {
                id: "open" as const,
                label: "See every debt",
                kind: "link" as const,
                href: "/loans",
              },
            ],
            dedupeKey: `paidoff:${app.id}`,
            priority: MESSAGE_PRIORITY.loan_paid_off,
          },
        ];
      }
      return [];
    }),
};
