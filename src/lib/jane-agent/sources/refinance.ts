import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { SEE_OFFERS } from "../refinance-replies";
import { snoozeButton, type MessageSource } from "./source";
import { formatRate } from "@/lib/percent";

// Refinance offers (spec step 111). Jane checks rates every month on its own
// (src/lib/refinance.ts) and brings one up only when switching would save at least
// REFI_MIN_SAVING_CENTS over the same months, fees included. Once per offer: a better one
// next month is news again, the same one isn't. Labelled demo advice. "Apply" only prepares
// the application (spec step 112); nothing is sent without the person's Submit.

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
          refs: {
            advice: true as const,
            refinance: { debtKey: c.debtKey, lender: pick.offer.lender },
          },
          actions: [
            // Spec step 112: prepares the application; nothing is sent until Submit.
            {
              id: "loan.prepare" as const,
              label: `Apply with ${pick.offer.lender}`,
              kind: "primary" as const,
            },
            SEE_OFFERS,
            snoozeButton(),
          ],
          dedupeKey: `offer:${c.debtKey}:${pick.offer.id}`,
          // The comparisons come biggest saving first: that one now, the rest when there's room.
          priority:
            index === 0 ? MESSAGE_PRIORITY.refinance_offer : MESSAGE_PRIORITY.refinance_more,
        },
      ];
    }),
};
