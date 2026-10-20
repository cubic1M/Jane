import { MESSAGE_PRIORITY, UNUSUAL_CHAT_MAX } from "@/config/agent-chat";
import { parseKey } from "@/detection/unusual";
import type { MessageSource } from "./source";

// Spotting the unusual (spec step 208): one message per unusual-activity alert, with
// "This was me" and "Not me" (for a missing refund: "Got it" and "Still missing").
export const unusualSource: MessageSource = {
  key: "unusual",
  gather(snapshot) {
    return (snapshot.unusual ?? []).slice(0, UNUSUAL_CHAT_MAX).map((alert) => {
      const refund = parseKey(alert.key)?.rule === "refund";
      return {
        kind: "decision" as const,
        body: `${alert.title}. ${alert.body} Was this you?`.replace("?. ", "? "),
        refs: { alertId: alert.id },
        actions: [
          {
            id: "unusual.me" as const,
            label: refund ? "Got it" : "This was me",
            kind: "primary" as const,
          },
          {
            id: "unusual.not_me" as const,
            label: refund ? "Still missing" : "Not me",
            kind: "secondary" as const,
          },
        ],
        dedupeKey: alert.id,
        priority: MESSAGE_PRIORITY.unusual,
      };
    });
  },
};
