import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Staying on a Yes (src/lib/follow-through.ts): a nudge when nothing's been done, the next step
// when a fix didn't hold. It stops when they act or say no.
export const followThroughSource: MessageSource = {
  key: "follow_through",
  gather(snapshot): Candidate[] {
    return (snapshot.followUps ?? []).map((f) => ({
      kind: "heads_up",
      body: f.body,
      refs: { followUp: f.key, followUpRound: f.round, followUpKind: f.kind },
      actions: [
        { id: "followup.done", label: "I did it", kind: "primary" },
        snoozeButton(),
        { id: "followup.no", label: "Not for me", kind: "secondary" },
        { id: "open", label: "Where to do it", kind: "link", href: f.href },
      ],
      dedupeKey: `followup:${f.kind}:${f.key}:${f.round}`,
      priority: MESSAGE_PRIORITY.follow_through,
    }));
  },
};

// An upload-only person's next statement is ready (src/planning/freshness.ts): once a cycle.
export const statementAskSource: MessageSource = {
  key: "statement_ask",
  gather(snapshot): Candidate[] {
    const ask = snapshot.statementAsk;
    if (!ask) return [];
    return [
      {
        kind: "heads_up",
        body: `${ask.title}. ${ask.body}`,
        refs: {},
        actions: [
          { id: "open", label: "Upload it", kind: "link", href: "/import" },
          snoozeButton(),
        ],
        dedupeKey: ask.key,
        priority: MESSAGE_PRIORITY.statement_ask,
      },
    ];
  },
};
