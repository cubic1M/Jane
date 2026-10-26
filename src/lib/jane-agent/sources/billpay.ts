import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { billPayReply } from "../replies-billpay";
import type { MessageSource } from "./source";

// Bills paid on time (spec step 145): each card or loan due soon that Jane scheduled by
// itself, would like to pay with one tap, or can't pay without checking running short.
export const billPaySource: MessageSource = {
  key: "billpay",
  gather(snapshot) {
    const view = snapshot.billPay;
    if (!view) return [];
    return view.items.flatMap((item) => {
      const reply = billPayReply(item, snapshot.asOf, view.payday);
      if (!reply) return [];
      return [
        {
          kind:
            item.status === "ask"
              ? ("decision" as const)
              : item.status === "scheduled"
                ? ("done" as const)
                : ("heads_up" as const),
          body: reply.body,
          refs: reply.refs,
          actions: reply.actions,
          dedupeKey: `${item.planKey}:${item.status}`,
          priority: MESSAGE_PRIORITY.billpay,
        },
      ];
    });
  },
};
