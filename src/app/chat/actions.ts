"use server";

import { after } from "next/server";
import { runAgentNow, runQueuedFor } from "@/lib/agent/run";
import { ChatActionError, takeChatAction } from "@/lib/jane-agent/actions";
import { timezoneOf } from "@/lib/jane-agent/open";
import { conciergeMode } from "@/lib/concierge-mode";
import { toView, type MessageView } from "@/lib/jane-agent/view";
import { requireUser } from "@/lib/session";

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
    const [{ message, agentJobIds, agentActionIds, posted }, timezone, concierge] =
      await Promise.all([
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
        conciergeMode(user.id),
      ]);
    // The agent's first step, after the response (src/lib/agent/run.ts).
    after(() => runAgentNow(agentJobIds));
    // Spec step 83: and what a new autopilot level approved at once, as Settings does.
    if (agentActionIds.length > 0) after(() => runQueuedFor(agentActionIds));
    return {
      message: toView(message, new Date(), timezone, { concierge }),
      error: null,
      ...(posted ? { postedAt: Date.now() } : {}),
    };
  } catch (error) {
    if (!(error instanceof ChatActionError)) throw error;
    return { message: previous.message, error: error.message };
  }
}
