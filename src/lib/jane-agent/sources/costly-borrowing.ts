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
    // Overdraft fees alone aren't borrowing to find a way out of: the bank fees suggestion brings
    // them up already (two or more fees), and a payday alternative loan isn't for someone who never
    // took a loan (debug 2, 11-15: "cost you $70.00 … most of it from overdraft fees" beside "Stop
    // paying overdraft and bank fees, save $139/yr", the same two $35 fees).
    if (d.kinds.every((k) => k.kind === "overdraft")) return [];
    const top = d.kinds[0];
    // How much of the cost the biggest kind is: "most" only when it is.
    const share =
      top.costCents >= d.totalYearlyCents
        ? "all of it"
        : top.costCents * 2 > d.totalYearlyCents
          ? "most of it"
          : "the biggest part";
    // An overdraft's yearly rate rests on an assumed overdraft: fine beside its basis in the chat's
    // answer, but alone on a card it only read as "about 17743% a year".
    return [
      {
        kind: "heads_up",
        body: `Costly short-term borrowing cost you ${formatCents(d.totalYearlyCents)} over the last year, ${share} from ${COSTLY_LABELS[top.kind].toLowerCase()}${top.aprBps !== null && top.kind !== "overdraft" ? ` (about ${Math.round(top.aprBps / 100)}% a year)` : ""}. There are cheaper ways out, like a credit union payday alternative loan, and a way to stop the cycle. Ask me "how much has costly borrowing cost me?" for the details.`,
        refs: {},
        actions: [COSTLY_PAGE, snoozeButton()],
        dedupeKey: `costly:${quarter(context.local.date)}`,
        priority: MESSAGE_PRIORITY.costly_borrowing,
      },
    ];
  },
};
