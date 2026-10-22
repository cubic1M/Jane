import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { COSTLY_LABELS } from "@/config/costly-borrowing";
import { formatCents } from "@/lib/money";
import { COSTLY_PAGE } from "../costly-borrowing-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Out of costly short-term borrowing (spec step 247): once a quarter, when payday loans, card
// cash advances, repeated overdrafts or pay advance apps cost enough over the year, Jane says
// what they cost and where the cheaper ways out are.

const quarter = (iso: string) =>
  `${iso.slice(0, 4)}q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;

export const costlyBorrowingSource: MessageSource = {
  key: "costly_borrowing",
  gather: (snapshot, context): Candidate[] => {
    const d = snapshot.costlyBorrowing;
    if (!d?.any) return [];
    const top = d.kinds[0];
    return [
      {
        kind: "heads_up",
        body: `Costly short-term borrowing cost you ${formatCents(d.totalYearlyCents)} over the last year, most of it from ${COSTLY_LABELS[top.kind].toLowerCase()}${top.aprBps !== null ? ` (about ${Math.round(top.aprBps / 100)}% a year)` : ""}. There are cheaper ways out, like a credit union payday alternative loan, and a way to stop the cycle. Ask me "how much has costly borrowing cost me?" for the details.`,
        refs: {},
        actions: [COSTLY_PAGE, snoozeButton()],
        dedupeKey: `costly:${quarter(context.local.date)}`,
        priority: MESSAGE_PRIORITY.costly_borrowing,
      },
    ];
  },
};
