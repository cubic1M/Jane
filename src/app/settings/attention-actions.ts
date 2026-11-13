"use server";

import { revalidatePath } from "next/cache";
import { AttentionError, resumeKind } from "@/lib/jane-agent/attention-load";
import { requireUser } from "@/lib/session";
import { ignoring } from "@/lib/ignoring";

// "Bring them back" on a kind of message Jane stopped bringing up (spec step 147), in
// Settings. Only for the signed-in person.

export async function bringBack(formData: FormData): Promise<void> {
  const user = await requireUser();
  await ignoring(AttentionError, () => resumeKind(user.id, String(formData.get("source") ?? "")));
  revalidatePath("/settings");
}
