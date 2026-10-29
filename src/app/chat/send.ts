"use server";

import { revalidatePath } from "next/cache";
import { currentChatStart } from "@/lib/chat-start";
import { ChatInputError, sendToJane } from "@/lib/jane-agent/typing";
import { requireUser } from "@/lib/session";

// Typing to Jane in the chat (spec step 84). Stores what the person typed and Jane's answer
// (src/lib/jane-agent/typing.ts), then refreshes the chat so both show at the bottom. The
// text is the person's own data: it's never logged, not even when something fails.

export type SendState = { error: string | null; sentAt: number };

export async function sendMessage(previous: SendState, formData: FormData): Promise<SendState> {
  const user = await requireUser();
  const text = String(formData.get("message") ?? "");
  try {
    await sendToJane(user.id, text, { since: await currentChatStart() });
  } catch (error) {
    if (error instanceof ChatInputError) return { error: error.message, sentAt: previous.sentAt };
    console.error("Typing to Jane failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return { error: "Something went wrong. Try again.", sentAt: previous.sentAt };
  }
  revalidatePath("/chat");
  return { error: null, sentAt: Date.now() };
}
