import { MONEY_DATE_DAY } from "@/config/money-for-two";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { moneyDateBody } from "../replies-two";
import type { MessageSource } from "./source";

// Money for two (spec step 242): each big move from the partner that waits for this person's
// tap (Approve or Decline), and once a month the money date, for both partners.
export const twoSource: MessageSource = {
  key: "two",
  gather(snapshot) {
    const view = snapshot.two;
    if (!view) return [];
    const waiting = view.bigMoves
      .filter((m) => !m.mine)
      .map((m) => ({
        kind: "decision" as const,
        body: `${view.partnerName} wants to move ${formatCents(m.amountCents)} to ${m.toName} out of an account you share, on ${m.runOn}. Moves this big need both your taps.`,
        refs: { transferId: m.id },
        actions: [
          { id: "two.approve" as const, label: "Approve", kind: "primary" as const },
          { id: "two.decline" as const, label: "Decline", kind: "secondary" as const },
        ],
        dedupeKey: `move:${m.id}`,
        priority: MESSAGE_PRIORITY.two,
      }));
    const day = Number(snapshot.asOf.slice(8, 10));
    const date =
      day >= MONEY_DATE_DAY
        ? [
            {
              kind: "heads_up" as const,
              body: moneyDateBody(view),
              refs: {},
              actions: [
                {
                  id: "open" as const,
                  label: "See household",
                  kind: "link" as const,
                  href: "/household",
                },
              ],
              dedupeKey: `date:${view.month}`,
              priority: MESSAGE_PRIORITY.two_date,
            },
          ]
        : [];
    return [...waiting, ...date];
  },
};
