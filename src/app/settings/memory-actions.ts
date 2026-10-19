"use server";

import { revalidatePath } from "next/cache";
import { deletePreference } from "@/lib/jane-agent/preferences";
import { requireUser } from "@/lib/session";

// "Forget" on something Jane remembers (spec step 91), in Settings. Only the signed-in
// person's own, through deletePreference, which scopes to them.

export async function forgetPreference(formData: FormData): Promise<void> {
  const user = await requireUser();
  await deletePreference(user.id, String(formData.get("preferenceId") ?? ""));
  revalidatePath("/settings");
}
