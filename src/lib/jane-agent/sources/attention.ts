import { ATTENTION_STOP_AFTER } from "@/config/attention";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { MessageSource } from "./source";

// Asking less (spec step 147): when Jane stops bringing up a kind of message the person
// never says yes to, she says so once, with how to bring it back.
export const attentionSource: MessageSource = {
  key: "attention",
  gather(snapshot) {
    return (snapshot.attention?.stopped ?? []).map((kind) => ({
      kind: "heads_up" as const,
      body: `I'll stop bringing up ${kind.label}: you haven't said yes to the last ${ATTENTION_STOP_AFTER}, so they don't seem useful right now. Urgent alerts, deadlines and bills still come straight away, and you can bring these back in Settings anytime.`,
      refs: { attentionSource: kind.source },
      actions: [
        { id: "attention.resume" as const, label: "Keep them coming", kind: "secondary" as const },
        {
          id: "open" as const,
          label: "Settings",
          kind: "link" as const,
          href: "/settings#asking-less",
        },
      ],
      dedupeKey: `${kind.source}:${kind.lastOn}`,
      priority: MESSAGE_PRIORITY.attention,
    }));
  },
};
