import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import type { AckIntent } from "./ack-intents";
import type { Reply } from "./replies";
import { parseActions } from "./types";

// A typed "yes", "no thanks" or "remind me tomorrow" (QA sweep). Jane acts only when a button
// is tapped, so "yes" points at the open message's own button rather than guessing; "no" leaves
// it be. Never an answer from some older message's button: Jane's own answers count too, so
// "yes" after "Want me to handle it?" points at that answer's Yes.

export async function ackReply(
  userId: string,
  intent: AckIntent,
  { client }: { client: PrismaClient },
): Promise<Reply> {
  if (intent.kind === "ack" && !intent.yes) {
    return { body: "I'll leave it. Ask me anything else.", actions: [], refs: {} };
  }
  const open = await scopedFor(userId, client).janeMessages.findFirst({
    where: { status: "open", kind: { in: ["decision", "brief", "reply"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { actions: true },
  });
  const actions = open ? parseActions(open.actions) : [];
  const primary = actions.find((a) => a.kind === "primary");
  const snooze = actions.find((a) => a.id === "snooze");
  if (intent.kind === "remind") {
    return {
      body: snooze
        ? `Tap "${snooze.label}" on that message and I'll bring it back tomorrow.`
        : "Tell me what to remind you about and when, and I'll note it.",
      actions: [],
      refs: {},
    };
  }
  return {
    body: primary
      ? `I only act when you tap, so tap "${primary.label}" on my message above to do it.`
      : "What would you like to do? Ask me anything about your money.",
    actions: [],
    refs: {},
  };
}
