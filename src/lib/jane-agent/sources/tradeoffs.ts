import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { tradeoffsReply } from "../replies-tradeoffs";
import type { MessageSource } from "./source";

// Goals that trade off openly (spec step 241): when goals compete and the person hasn't picked
// an order, one message with each order's dates, Jane's suggestion and why, and the tap.
export const tradeoffsSource: MessageSource = {
  key: "tradeoffs",
  gather(snapshot) {
    const view = snapshot.tradeoffs;
    if (!view?.competing || !view.suggested || view.chosen) return [];
    const reply = tradeoffsReply(view);
    return [
      {
        kind: "decision" as const,
        body: reply.body,
        refs: reply.refs,
        actions: reply.actions,
        // Asked again only when the goals or the suggestion change.
        dedupeKey: view.suggested.order.join(","),
        priority: MESSAGE_PRIORITY.tradeoffs,
      },
    ];
  },
};
