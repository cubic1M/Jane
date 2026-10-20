"use server";

import { revalidatePath } from "next/cache";
import { AttentionError, resumeKind } from "@/lib/jane-agent/attention-load";
import { requireUser } from "@/lib/session";

// "Bring them back" on a kind of message Jane stopped bringing up (spec step 147), in
// Settings. Only for the signed-in person.

export async function bringBack(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await resumeKind(user.id, String(formData.get("source") ?? ""));
  } catch (error) {
    if (!(error instanceof AttentionError)) throw error;
  }
  revalidatePath("/settings");
}
