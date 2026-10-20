import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { reportReply } from "../replies-report";
import type { MessageSource } from "./source";

// The monthly money report (spec step 148): posted once, when it's made.
export const reportSource: MessageSource = {
  key: "report",
  gather(snapshot) {
    const stored = snapshot.monthlyReport;
    if (!stored) return [];
    const reply = reportReply(stored);
    return [
      {
        kind: "done",
        body: reply.body,
        refs: reply.refs,
        actions: reply.actions,
        dedupeKey: stored.month,
        priority: MESSAGE_PRIORITY.report,
      },
    ];
  },
};
