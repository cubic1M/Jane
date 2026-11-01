import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import type { MessageSource } from "./source";

// "Is it rent you collect?" (debugger 11-01): about the same amount from one person by Zelle or
// Venmo near the start of each month, filed as a transfer in. A tenant's rent is income; a
// roommate's share of the person's own rent isn't, and the two look the same, so Jane asks. Asked
// once per payer (src/lib/rent-question.ts).
export const rentInQuestionSource: MessageSource = {
  key: "rent_in_question",
  gather(snapshot) {
    const rent = snapshot.rentInQuestion;
    if (!rent) return [];
    return [
      {
        kind: "decision" as const,
        body: `${rent.name} sends you ${formatCents(rent.amountCents)} near the start of each month (${rent.months} months so far). Is it rent you collect? If it is, I'll count it as rental income, in your income and your taxes. If it's someone's share of your own rent, say no.`,
        refs: { rentKey: rent.merchantKey },
        actions: [
          { id: "rent_in.yes" as const, label: "Yes, rent I collect", kind: "secondary" as const },
          { id: "rent_in.no" as const, label: "No", kind: "secondary" as const },
        ],
        dedupeKey: `rent-in:${rent.merchantKey}`,
        priority: MESSAGE_PRIORITY.rent_in_question,
      },
    ];
  },
};
