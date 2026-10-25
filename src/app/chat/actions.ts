"use server";

import { after } from "next/server";
import { runAgentNow, runQueuedFor } from "@/lib/agent/run";
import { ChatActionError, takeChatAction } from "@/lib/jane-agent/actions";
import { timezoneOf } from "@/lib/jane-agent/open";
import { toView, type MessageView } from "@/lib/jane-agent/view";
import { requireUser } from "@/lib/session";
import { scopedFor } from "@/lib/db-scoped";
import { recordOpened } from "@/lib/outcomes";

// A tap on a button in Jane's chat (spec step 81). Everything is checked again on the
// server (src/lib/jane-agent/actions): the message is the person's own, still open, and
// offers that button. No revalidate: the message stays on screen with its answer.

// postedAt: when a tap posted a new message (spec step 88: a clarifying question's answer),
// so the chat reloads to show it.
export type MessageState = { message: MessageView; error: string | null; postedAt?: number };

export async function tapButton(previous: MessageState, formData: FormData): Promise<MessageState> {
  const user = await requireUser();
  const messageId = String(formData.get("messageId") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  // A button that carries a choice (option.pick: the option's id).
  const choice = formData.get("choice");
  try {
    // The timezone is read alongside the tap, and what the answer doesn't need (audit,
    // analytics, closing the messages it settled) follows the response.
    const [{ message, agentJobIds, agentActionIds, posted }, timezone] = await Promise.all([
      takeChatAction(user.id, messageId, actionId, {
        ...(typeof choice === "string" && choice ? { choice: choice.slice(0, 80) } : {}),
        defer: (work) =>
          after(() =>
            work().catch((error) =>
              console.error("After a chat tap failed", { error: String(error) }),
            ),
          ),
      }),
      timezoneOf(user.id),
    ]);
    // The agent's first step, after the response (src/lib/agent/run.ts).
    after(() => runAgentNow(agentJobIds));
    // Spec step 83: and what a new autopilot level approved at once, as Settings does.
    if (agentActionIds.length > 0) after(() => runQueuedFor(agentActionIds));
    return {
      message: toView(message, new Date(), timezone),
      error: null,
      ...(posted ? { postedAt: Date.now() } : {}),
    };
  } catch (error) {
    if (!(error instanceof ChatActionError)) throw error;
    return { message: previous.message, error: error.message };
  }
}

// More details opened on a suggestion card: kept on the verified savings record (it was looked
// at). The message must be the person's own; anything else is ignored.
export async function noteDetailsOpened(messageId: string): Promise<void> {
  const user = await requireUser();
  const message = await scopedFor(user.id).janeMessages.findFirst({
    where: { id: messageId },
    select: { refs: true },
  });
  const key = (message?.refs as { suggestion?: unknown } | null)?.suggestion;
  if (typeof key === "string") await recordOpened(user.id, key);
}
