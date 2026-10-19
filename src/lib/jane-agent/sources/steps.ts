import { createHash } from "node:crypto";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { Candidate, MessageAction } from "../types";
import type { SnapshotAgentStep } from "../snapshot-more";
import { snoozeButton, type MessageSource } from "./source";

// Things waiting on the person (spec step 83): the steps only they can do on something
// Jane's agent is working on, with the same buttons and links as the actions page. A
// company's question the agent couldn't answer ("Answer" opens the action), an offer made
// on a call (Accept or Decline, through answerOffer), a company that only cancels from
// the person's own page ("Open cancel page" and "I've cancelled", through
// markSelfCancelled) and a switch waiting for the person to sign up ("Sign up"). Each
// once; a new question is a new message.

const PRIORITY = MESSAGE_PRIORITY.agent_step;

const detailsHref = (s: SnapshotAgentStep) => `/actions#action-${s.actionId}`;
const link = (label: string, href: string): MessageAction => ({
  id: "open",
  label,
  kind: "link",
  href,
});

// The actions page's own instruction, said for the chat instead.
const withoutPageHint = (todo: string | null) =>
  (todo ?? "")
    .replace(/\s*Answer on your actions page and Jane will reply\.?$/, "")
    .replace(/\s*Nothing was accepted: say yes or no on your actions page\.?$/, "")
    .trim();

const shortHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

function candidate(s: SnapshotAgentStep): Candidate {
  switch (s.step) {
    case "question":
      return {
        kind: "heads_up",
        body: `I need your answer on "${s.title}". ${withoutPageHint(s.todo) || `${s.company} asked something I can't answer for you.`} Tap Answer and I'll send it on.`,
        refs: { actionId: s.actionId, step: s.step },
        actions: [link("Answer", detailsHref(s)), snoozeButton()],
        dedupeKey: `question:${s.actionId}:${shortHash(s.todo ?? "")}`,
        priority: PRIORITY,
      };
    case "offer":
      return {
        kind: "decision",
        body: `On the call about "${s.title}": ${withoutPageHint(s.todo) || `${s.company} made an offer.`} Nothing was accepted. Do you want it?`,
        refs: { actionId: s.actionId, step: s.step },
        actions: [
          { id: "offer.accept", label: "Accept", kind: "primary" },
          { id: "offer.decline", label: "Decline", kind: "secondary" },
          link("Details", detailsHref(s)),
        ],
        dedupeKey: `offer:${s.actionId}`,
        priority: PRIORITY,
      };
    case "self_cancel":
      return {
        kind: "heads_up",
        body: `${s.company} only cancels from your own account, so "${s.title}" needs you: open their cancel page and cancel. I'll watch for the next charge to make sure, and you can tell me when it's done.`,
        refs: { actionId: s.actionId, step: s.step },
        actions: [
          { id: "cancel.done", label: "I've cancelled", kind: "primary" },
          link("Open cancel page", s.url ?? detailsHref(s)),
          snoozeButton(),
        ],
        dedupeKey: `cancel:${s.actionId}`,
        priority: PRIORITY,
      };
    case "switch":
      return {
        kind: "heads_up",
        body: `Your switch${s.switchName ? ` to ${s.switchName}` : ""} is ready for you. ${s.todo ?? "Sign up with the link; I'll watch your account for it."}`,
        refs: { actionId: s.actionId, step: s.step },
        actions: [link("Sign up", s.url ?? detailsHref(s)), snoozeButton()],
        dedupeKey: `switch:${s.actionId}`,
        priority: PRIORITY,
      };
  }
}

export const stepsSource: MessageSource = {
  key: "steps",
  gather: (snapshot) => snapshot.agentSteps.map(candidate),
};
