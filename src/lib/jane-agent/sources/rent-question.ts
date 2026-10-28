import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import type { MessageSource } from "./source";

// "Is this your rent?" (CSV bench, round 24): about the same amount sent to one person by Zelle or
// Venmo near the start of each month, filed as a transfer. A yes files those payments as rent
// (spending, bills, the idle-cash cushion), past and future; a no keeps them as transfers. Asked
// once per payee (src/lib/rent-question.ts).
export const rentQuestionSource: MessageSource = {
  key: "rent_question",
  gather(snapshot) {
    const rent = snapshot.rentQuestion;
    if (!rent) return [];
    return [
      {
        kind: "decision" as const,
        body: `You send ${rent.name} ${formatCents(rent.amountCents)} near the start of each month (${rent.months} months so far). Is this your rent? If it is, I'll count it as rent in your spending, your bills and your cushion.`,
        refs: { rentKey: rent.merchantKey },
        actions: [
          { id: "rent.yes" as const, label: "Yes, it's rent", kind: "secondary" as const },
          { id: "rent.no" as const, label: "No", kind: "secondary" as const },
        ],
        dedupeKey: rent.merchantKey,
        priority: MESSAGE_PRIORITY.rent_question,
      },
    ];
  },
};
