import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { MessageSource } from "./source";

// When income stops (spec step 204): one question when a paycheck hasn't come in (never
// inside its window: that's the late-paycheck change's rule), and one note when pay is back.
export const leanSource: MessageSource = {
  key: "lean",
  gather(snapshot) {
    const lean = snapshot.lean;
    if (!lean) return [];
    return [
      ...lean.open
        .filter((l) => l.status === "proposed")
        .map((l) => ({
          kind: "decision" as const,
          body: `Your paycheck from ${l.employer} hasn't come in; it was due ${l.dueOn}. Want me to switch to a lean plan until it does? I'd pause automatic transfers and list what can wait, help with hardship options and the unemployment steps.`,
          refs: { leanId: l.id },
          actions: [
            { id: "lean.start" as const, label: "Yes, lean plan", kind: "primary" as const },
            { id: "lean.not_now" as const, label: "No, it's coming", kind: "secondary" as const },
          ],
          dedupeKey: `ask:${l.id}`,
          priority: MESSAGE_PRIORITY.lean,
        })),
      ...lean.ended.map((l) => ({
        kind: "done" as const,
        body: `Your paycheck from ${l.employer} is back, so I'm back to normal: automatic transfers are on again.`,
        refs: {},
        actions: [],
        dedupeKey: `ended:${l.id}`,
        priority: MESSAGE_PRIORITY.lean,
      })),
    ];
  },
};
