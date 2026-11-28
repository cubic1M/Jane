"use server";

import { revalidatePath } from "next/cache";
import { clearChat } from "@/lib/jane-agent/clear-chat";
import { log } from "@/lib/log";
import { requireUser } from "@/lib/session";

// "Clear chat": deletes the signed-in person's own chat for good (src/lib/jane-agent/clear-chat.ts).
// Only with the confirm field the box's second tap sends; an error is said, never swallowed.

export type ClearChatState = { error: string | null; clearedAt: number };

export async function clearChatAction(
  previous: ClearChatState,
  formData: FormData,
): Promise<ClearChatState> {
  const user = await requireUser();
  if (formData.get("confirm") !== "yes") return previous;
  try {
    await clearChat(user.id);
  } catch (error) {
    log.error("Clearing the chat failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return { error: "Couldn't clear the chat. Nothing was deleted. Try again.", clearedAt: 0 };
  }
  revalidatePath("/chat");
  return { error: null, clearedAt: Date.now() };
}
