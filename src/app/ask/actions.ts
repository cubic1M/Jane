"use server";

import { redirect } from "next/navigation";
import { deleteConversation } from "@/lib/ask/conversations";
import { requireUser } from "@/lib/session";

// Deletes one of the signed-in person's conversations.
export async function deleteAskConversation(formData: FormData): Promise<void> {
  const user = await requireUser();
  await deleteConversation(user.id, String(formData.get("conversationId") ?? ""));
  redirect("/ask");
}
