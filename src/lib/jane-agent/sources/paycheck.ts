import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { paycheckReply } from "../replies-paycheck";
import type { MessageSource } from "./source";

// Money that moves itself (spec step 144): once per paycheck, what Jane moved and what she'd
// like to move, with Move them, Not this time and Undo.
export const paycheckSource: MessageSource = {
  key: "paycheck",
  gather(snapshot) {
    const plan = snapshot.paycheck;
    if (!plan || plan.moves.length === 0 || plan.status === "skipped") return [];
    const reply = paycheckReply(plan);
    return [
      {
        kind: plan.moves.some((m) => m.status === "asked") ? "decision" : "done",
        body: reply.body,
        refs: reply.refs,
        actions: reply.actions,
        dedupeKey: plan.id,
        priority: MESSAGE_PRIORITY.paycheck,
      },
    ];
  },
};
