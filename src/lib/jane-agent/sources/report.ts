import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { closedNote } from "../replies-close";
import { reportReply } from "../replies-report";
import type { MessageSource } from "./source";

// The monthly money report (spec step 148): posted once, when it's made. It also says the month
// is closed (spec step 244) when it is: the close's figures are the report's, so one message
// covers both.
export const reportSource: MessageSource = {
  key: "report",
  gather(snapshot) {
    const stored = snapshot.monthlyReport;
    if (!stored) return [];
    const reply = reportReply(stored);
    const close = snapshot.close;
    const closed = close?.status === "closed" && close.month === stored.month;
    return [
      {
        kind: "done",
        body: closed ? `${reply.body}\n${closedNote(close)}` : reply.body,
        refs: reply.refs,
        actions: reply.actions,
        dedupeKey: stored.month,
        priority: MESSAGE_PRIORITY.report,
      },
    ];
  },
};
