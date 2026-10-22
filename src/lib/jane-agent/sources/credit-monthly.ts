import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { monthlyMessage } from "../credit-monthly-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// The monthly credit check-up (spec step 251): once for each month Jane did it, one message with
// what she did and a button for each item that waits for the person. Quiet when nothing does.

export const creditMonthlySource: MessageSource = {
  key: "credit_monthly",
  gather: (snapshot): Candidate[] => {
    const d = snapshot.creditMonthly;
    if (!d?.available || !d.items.some((i) => i.status === "tap")) return [];
    const msg = monthlyMessage(d);
    return [
      {
        kind: "decision",
        body: msg.body,
        refs: msg.refs,
        actions: [...msg.actions, snoozeButton()],
        dedupeKey: `creditmonth:${d.month}`,
        priority: MESSAGE_PRIORITY.credit_monthly,
      },
    ];
  },
};
