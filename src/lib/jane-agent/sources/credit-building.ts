import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { CREDIT_PAGE } from "../credit-replies";
import { builderButton, payButton, statementLine } from "../credit-building-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Building credit (spec step 175). Before a card's statement closes: the payment Jane
// scheduled by herself (from "Handle the safe stuff", within the debt caps), or the one to
// make with one tap. A well done at each on-time streak milestone, and a credit-builder
// stand-in for a thin file, once a year.

export const creditBuildingSource: MessageSource = {
  key: "credit_building",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.creditBuilding;
    if (!data?.available) return [];
    const out: Candidate[] = [];
    const s = data.statement;
    const line = statementLine(data);
    if (s && s.due && line) {
      if (s.scheduled) {
        out.push({
          kind: "done",
          body: line,
          refs: { advice: true },
          actions: [CREDIT_PAGE],
          dedupeKey: `statement_paid:${s.accountId}:${s.closesOn}`,
          priority: MESSAGE_PRIORITY.statement_paid,
        });
      } else if (s.suggested && s.canPay) {
        out.push({
          kind: "decision",
          body: line,
          refs: { advice: true, creditStatement: { accountId: s.accountId, closesOn: s.closesOn } },
          actions: [payButton(), CREDIT_PAGE, snoozeButton()],
          dedupeKey: `statement:${s.accountId}:${s.closesOn}`,
          priority: MESSAGE_PRIORITY.statement_pay,
        });
      }
    }
    const st = data.streak;
    if (st?.milestone) {
      out.push({
        kind: "done",
        body: `${st.milestone} months in a row with every payment on time. Payment history counts most in a credit score, so this is the habit that builds it.`,
        refs: {},
        actions: [CREDIT_PAGE],
        dedupeKey: `streak:${st.milestone}:${st.since}`,
        priority: MESSAGE_PRIORITY.credit_streak,
      });
    }
    const builder = data.thin ? data.builders[0] : undefined;
    if (builder) {
      out.push({
        kind: "decision",
        body: `Your credit file is thin, which keeps a score low however well you pay. The ${builder.name} from ${builder.issuer} builds it: ${builder.summary}`,
        refs: { advice: true, creditBuilder: { productId: builder.id } },
        actions: [builderButton(builder.name), CREDIT_PAGE, snoozeButton()],
        dedupeKey: `builder:${builder.id}:${snapshot.asOf.slice(0, 4)}`,
        priority: MESSAGE_PRIORITY.credit_builder,
      });
    }
    return out;
  },
};
