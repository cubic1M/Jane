import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { checkedReply } from "../replies-checked";
import type { MessageSource } from "./source";

// "What I checked last night" (spec step 142): once per nightly run, in the morning, one
// line per sector. Low priority: on a busy day the brief and what needs the person go first.
export const checkedSource: MessageSource = {
  key: "checked",
  gather(snapshot) {
    const run = snapshot.lastRun;
    if (!run || run.steps.length === 0) return [];
    const reply = checkedReply(run);
    return [
      {
        kind: "done",
        body: reply.body,
        refs: {},
        actions: reply.actions,
        dedupeKey: run.day,
        priority: MESSAGE_PRIORITY.checked,
      },
    ];
  },
};
