import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatRate } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import { SEE_OFFERS } from "../refinance-replies";
import { snoozeButton, type MessageSource } from "./source";

// Refinance offers (spec step 111). Jane checks rates every month by herself
// (src/lib/refinance.ts) and brings one up only when switching would save at least
// REFI_MIN_SAVING_CENTS over the same months, fees included. Once per offer: a better one
// next month is news again, the same one isn't. Labelled demo advice; never applied for.

export const refinanceSource: MessageSource = {
  key: "refinance",
  gather: (snapshot) =>
    (snapshot.refinance?.comparisons ?? []).flatMap((c, index) => {
      const pick = c.pick;
      if (!pick) return [];
      return [
        {
          kind: "decision" as const,
          body: [
            `I checked loan rates for you. Your ${c.debtName} (${formatRate(c.currentAprBps)}, ${formatCents(c.balanceCents)} left) could move to ${pick.offer.lender} at ${formatRate(pick.offer.aprBps)} ${pick.offer.rateType}.`,
            ...c.why,
            "These are sample offers from a stand-in lender catalog. Nothing is applied for until you say so.",
          ].join("\n"),
          refs: { advice: true as const },
          actions: [SEE_OFFERS, snoozeButton()],
          dedupeKey: `offer:${c.debtKey}:${pick.offer.id}`,
          // The comparisons come biggest saving first: that one now, the rest when there's room.
          priority:
            index === 0 ? MESSAGE_PRIORITY.refinance_offer : MESSAGE_PRIORITY.refinance_more,
        },
      ];
    }),
};
