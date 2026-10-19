import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { MORTGAGE_PAGE, pmiLines } from "../mortgage-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// The mortgage (spec step 115). Jane raises PMI removal once, when the home's value the
// person gave puts the loan under 80%, with the steps and a request she drafted; and an
// escrow change in the payment, once per change.

export const mortgageSource: MessageSource = {
  key: "mortgage",
  gather: (snapshot): Candidate[] => {
    const m = snapshot.mortgage;
    if (!m) return [];
    const out: Candidate[] = [];
    if (m.pmi.kind === "can_ask" && m.loan.accountId) {
      out.push({
        kind: "decision",
        body: [...pmiLines(m), "I've drafted the request for you to send your servicer."].join(
          "\n",
        ),
        refs: {},
        actions: [
          {
            id: "open",
            label: "See the steps and the request",
            kind: "link",
            href: "/loans/mortgage#pmi",
          },
          snoozeButton(),
        ],
        // Once per loan: PMI removal is raised a single time.
        dedupeKey: `pmi:${m.loan.accountId}`,
        priority: MESSAGE_PRIORITY.mortgage_pmi,
      });
    }
    if (m.escrow) {
      out.push({
        kind: "heads_up",
        body: `Your mortgage payment went ${m.escrow.changeCents > 0 ? "up" : "down"} ${formatCents(Math.abs(m.escrow.changeCents))}, from ${formatCents(m.escrow.fromCents)} to ${formatCents(m.escrow.toCents)}. Your rate is fixed, so it's escrow: usually property taxes or home insurance. Your servicer's escrow statement says which${m.escrow.changeCents > 0 ? ", and a home insurance quote could bring it back down" : ""}.`,
        refs: {},
        actions: [MORTGAGE_PAGE],
        dedupeKey: `escrow:${m.loan.accountId}:${m.escrow.toCents}`,
        priority: MESSAGE_PRIORITY.mortgage_escrow,
      });
    }
    return out;
  },
};
