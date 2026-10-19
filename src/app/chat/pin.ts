"use server";

import { revalidatePath } from "next/cache";
import { setPinned } from "@/lib/jane-agent/messages";
import { requireUser } from "@/lib/session";

// Pin or unpin a message in Jane's chat (spec step 96), the signed-in person's own only.
export async function togglePin(formData: FormData): Promise<void> {
  const user = await requireUser();
  await setPinned(
    user.id,
    String(formData.get("messageId") ?? ""),
    formData.get("pinned") === "true",
  );
  revalidatePath("/chat");
}
