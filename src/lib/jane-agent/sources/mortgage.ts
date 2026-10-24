import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { MORTGAGE_PAGE } from "../mortgage-replies";
import type { Candidate } from "../types";
import type { MessageSource } from "./source";

// The mortgage (spec step 115): an escrow change in the payment, once per change. PMI removal
// is raised by the home-equity source (./home-equity.ts), by the one PMI rule.

export const mortgageSource: MessageSource = {
  key: "mortgage",
  gather: (snapshot): Candidate[] => {
    const m = snapshot.mortgage;
    if (!m) return [];
    const out: Candidate[] = [];
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
