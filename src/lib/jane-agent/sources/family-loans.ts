import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { FAMILY_PAGE, candidateQuestion, noButton, yesButton } from "../family-loans-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Money between family and friends (spec step 226). A big payment-app transfer asked about
// once; a reminder drafted for the person to send themselves when a loan has been open a
// month; a co-signed loan with a late payment. Jane never messages the other person.

export const familyLoansSource: MessageSource = {
  key: "family_loans",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.familyLoans;
    if (!data) return [];
    const out: Candidate[] = [];
    const first = data.candidates[0];
    if (first) {
      out.push({
        kind: "decision",
        body: candidateQuestion(first),
        refs: { familyLoan: { id: first.id } },
        actions: [
          yesButton(first.kind, first.parsed.counterparty.split(" ")[0]),
          noButton(),
          snoozeButton(),
        ],
        dedupeKey: `famloan:${first.id}`,
        priority: MESSAGE_PRIORITY.family_candidate,
      });
    }
    for (const l of data.loans) {
      if (!l.reminder) continue;
      out.push({
        kind: "heads_up",
        body: `${l.counterparty} still owes you ${formatCents(l.balanceCents)}, ${l.daysOpen} days on. If you'd like to nudge them, here's a kind note you can send yourself: "${l.reminder.text}" I won't message ${l.counterparty.split(" ")[0]}.`,
        refs: {},
        actions: [FAMILY_PAGE, snoozeButton()],
        dedupeKey: `famremind:${l.id}:${l.reminder.round}`,
        priority: MESSAGE_PRIORITY.family_reminder,
      });
    }
    for (const c of data.cosigned) {
      if (!c.missed) continue;
      out.push({
        kind: "heads_up",
        body: `A payment on the ${c.debtName} you co-signed for ${c.counterparty} looks late${c.pastDueCents ? ` (${formatCents(c.pastDueCents)} past due)` : ""}. It can hurt your credit too. Here's a note you can send yourself: "${c.text}" I won't message them.`,
        refs: {},
        actions: [FAMILY_PAGE],
        dedupeKey: `cosigned:${c.id}:${c.nextDue ?? "late"}`,
        priority: MESSAGE_PRIORITY.cosigned_late,
      });
    }
    return out;
  },
};
