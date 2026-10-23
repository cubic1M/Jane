import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { closeReply } from "../replies-close";
import type { MessageSource } from "./source";

// The monthly close (spec step 244): the one question while it waits on charges Jane wasn't
// sure of, then once it's closed, the month in a few lines. Each once per month.
export const closeSource: MessageSource = {
  key: "close",
  gather(snapshot) {
    const view = snapshot.close;
    if (!view) return [];
    const reply = closeReply(view);
    return [
      {
        kind: view.status === "waiting" ? ("decision" as const) : ("done" as const),
        body: reply.body,
        refs: reply.refs,
        actions: reply.actions,
        dedupeKey: `${view.status}:${view.month}`,
        priority: MESSAGE_PRIORITY.close,
      },
    ];
  },
};
