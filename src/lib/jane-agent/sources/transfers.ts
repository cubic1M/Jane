import { BT_REMIND_DAYS } from "@/config/debt";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatRate } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import { daysUntil, dueReminder, shortMonth } from "@/planning/balance-transfer";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Balance transfers (spec step 113). Jane brings up a 0% transfer card when it saves enough
// against keeping a card's balance, the fee counted (once per offer, labelled demo advice),
// and, once the person has moved a balance, reminds them 60, 30 and 7 days before the 0%
// ends, each once, so the end date is never missed.

const OFFERS = {
  id: "open" as const,
  label: "See the offers",
  kind: "link" as const,
  href: "/loans/refinance#transfers",
};

export const transfersSource: MessageSource = {
  key: "transfers",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.transfers;
    if (!data) return [];
    const running = new Set(
      data.transfers.filter((t) => t.status === "active").map((t) => t.fromDebtKey),
    );
    const offers = data.comparisons.flatMap((c): Candidate[] => {
      const pick = c.pick;
      if (!pick || running.has(c.debtKey)) return [];
      return [
        {
          kind: "decision",
          body: [
            `A 0% balance transfer could cut the interest on your ${c.debtName} (${formatCents(c.balanceCents)} at ${formatRate(c.aprBps)}): ${pick.offer.cardName} from ${pick.offer.issuer}.`,
            ...c.why,
            "Opening the card and moving the balance are yours to do. Tell me when you have, and I'll keep the end date in view.",
            "This is a sample offer from a stand-in catalog.",
          ].join("\n"),
          refs: { advice: true, transfer: { debtKey: c.debtKey, offerId: pick.offer.id } },
          actions: [
            {
              id: "transfer.start",
              label: `I've moved it to ${pick.offer.cardName}`,
              kind: "primary",
            },
            OFFERS,
            snoozeButton(),
          ],
          dedupeKey: `offer:${c.debtKey}:${pick.offer.id}`,
          priority: MESSAGE_PRIORITY.transfer_offer,
        },
      ];
    });
    const reminders = data.transfers.flatMap((t): Candidate[] => {
      if (t.status !== "active") return [];
      const due = dueReminder(snapshot.asOf, t.promoEndsOn, BT_REMIND_DAYS);
      if (due === null) return [];
      const left = daysUntil(snapshot.asOf, t.promoEndsOn);
      return [
        {
          kind: "heads_up",
          body: `Your 0% on ${t.cardName} ends ${shortMonth(t.promoEndsOn)}, in ${left} ${left === 1 ? "day" : "days"}. Anything left then is charged ${formatRate(t.goToAprBps)}. The plan was ${formatCents(t.monthlyNeededCents)} a month to clear the ${formatCents(t.amountCents + t.feeCents)} you moved, fee included.`,
          refs: { transferId: t.id },
          actions: [
            { id: "transfer.done", label: "It's paid off", kind: "primary" },
            { id: "open", label: "See deadlines", kind: "link", href: "/deadlines" },
          ],
          dedupeKey: `remind:${t.id}:${due}`,
          priority: MESSAGE_PRIORITY.transfer_reminder,
        },
      ];
    });
    return [...reminders, ...offers];
  },
};
