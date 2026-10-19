"use server";

import { after } from "next/server";
import { runAgentNow, runQueuedFor } from "@/lib/agent/run";
import { ChatActionError, takeChatAction } from "@/lib/jane-agent/actions";
import { timezoneOf } from "@/lib/jane-agent/open";
import { toView, type MessageView } from "@/lib/jane-agent/view";
import { requireUser } from "@/lib/session";

// A tap on a button in Jane's chat (spec step 81). Everything is checked again on the
// server (src/lib/jane-agent/actions): the message is the person's own, still open, and
// offers that button. No revalidate: the message stays on screen with its answer.

export type MessageState = { message: MessageView; error: string | null };

export async function tapButton(previous: MessageState, formData: FormData): Promise<MessageState> {
  const user = await requireUser();
  const messageId = String(formData.get("messageId") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  try {
    const { message, agentJobIds, agentActionIds } = await takeChatAction(
      user.id,
      messageId,
      actionId,
    );
    // The agent's first step, after the response (src/lib/agent/run.ts).
    after(() => runAgentNow(agentJobIds));
    // Spec step 83: and what a new autopilot level approved at once, as Settings does.
    if (agentActionIds.length > 0) after(() => runQueuedFor(agentActionIds));
    return { message: toView(message, new Date(), await timezoneOf(user.id)), error: null };
  } catch (error) {
    if (!(error instanceof ChatActionError)) throw error;
    return { message: previous.message, error: error.message };
  }
}
