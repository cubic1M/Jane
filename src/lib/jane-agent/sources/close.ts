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
    // The scan's month-close suggestion asks about the same charges with its button: one card
    // (debug 2, 11-16: "Confirm 1 charge to close October: $20" and "Closing October 2026: I
    // wasn't sure what this charge was", both OpenAI's $20, in one day's dock).
    if ((snapshot.suggestions ?? []).some((s) => s.topic === "month_close")) return [];
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
