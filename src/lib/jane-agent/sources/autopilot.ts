import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { AUTOPILOT_LEVELS, AUTOPILOT_ORDER, AUTOPILOT_RECOMMENDED } from "@/config/autopilot";
import type { MessageAction } from "../types";
import type { MessageSource } from "./source";

// The autopilot question (spec step 83): until the person picks how much Jane does on its
// own, one message with the three choices, each through setAutopilot like Settings. Once
// only (and outside the daily limit, CHAT_UNCAPPED_SOURCES). Whatever the choice, moving
// money, calls, cancellations and insurance still wait for the person's own yes.

export const autopilotSource: MessageSource = {
  key: "autopilot",
  gather(snapshot) {
    if (snapshot.autopilot !== null) return [];
    const choices = AUTOPILOT_ORDER.map((level) => AUTOPILOT_LEVELS[level]);
    return [
      {
        kind: "decision",
        body: [
          "How much should I do on my own?",
          ...choices.map((c) => `${c.label}: ${c.description}`),
        ].join("\n"),
        refs: {},
        actions: [
          ...AUTOPILOT_ORDER.map((level): MessageAction => ({
            id: `autopilot.${level}`,
            label: AUTOPILOT_LEVELS[level].label,
            kind: level === AUTOPILOT_RECOMMENDED ? "primary" : "secondary",
          })),
          { id: "open", label: "Settings", kind: "link", href: "/settings#autopilot" },
        ],
        dedupeKey: "ask",
        priority: MESSAGE_PRIORITY.autopilot,
      },
    ];
  },
};
