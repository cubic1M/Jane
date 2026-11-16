import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { closeReply } from "../replies-close";
import type { MessageSource } from "./source";

// The monthly close (spec step 244): the one question while it waits on charges Jane wasn't
// sure of, then once it's closed, the month in a few lines. Each once per month.
export const closeSource: MessageSource = {
  key: "close",
  gather(snapshot) {
    const view = snapshot.close;
    // A closed month is said in the month's report message (./report.ts), which has the same
    // figures: only a close that needs the person's tap is a message of its own.
    if (!view || view.status !== "waiting") return [];
    // The one card for it: the scan's month-close suggestion isn't raised beside it
    // (./suggestions.ts), since only this one can say "Looks right" (debug 2, 11-16).
    const reply = closeReply(view);
    return [
      {
        kind: "decision" as const,
        body: reply.body,
        refs: reply.refs,
        actions: reply.actions,
        dedupeKey: `${view.status}:${view.month}`,
        priority: MESSAGE_PRIORITY.close,
      },
    ];
  },
};
