import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { steadyReply } from "../replies-steady";
import type { MessageSource } from "./source";

// A steady paycheck from uneven income (spec step 240): once a month, what the paycheck is and
// that it went (or the one tap to send it).
export const steadySource: MessageSource = {
  key: "steady",
  gather(snapshot) {
    const view = snapshot.steady;
    if (!view?.uneven || !view.plan || view.plan.status === "not_enough_history") return [];
    const reply = steadyReply(view);
    return [
      {
        kind: view.sent ? ("done" as const) : ("decision" as const),
        body: reply.body,
        refs: reply.refs,
        actions: reply.actions,
        dedupeKey: view.month,
        priority: MESSAGE_PRIORITY.steady,
      },
    ];
  },
};
