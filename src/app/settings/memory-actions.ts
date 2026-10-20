"use server";

import { revalidatePath } from "next/cache";
import { deletePreference, savePreference } from "@/lib/jane-agent/preferences";
import { lengthDraft, voiceDraft } from "@/lib/jane-agent/style";
import { requireUser } from "@/lib/session";

// "Forget" on something Jane remembers (spec step 91), in Settings. Only the signed-in
// person's own, through deletePreference, which scopes to them.

export async function forgetPreference(formData: FormData): Promise<void> {
  const user = await requireUser();
  await deletePreference(user.id, String(formData.get("preferenceId") ?? ""));
  revalidatePath("/settings");
}

// How Jane talks (spec step 188): the three choices, each saved as the person's own style.
export async function saveStyle(formData: FormData): Promise<void> {
  const user = await requireUser();
  const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const value = String(formData.get(name) ?? "");
    return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  };
  const length = pick("length", ["short", "normal", "detailed"] as const, "normal");
  const voice = pick("voice", ["plain", "numbers"] as const, "plain");
  const posting = pick("posting", ["daily", "as_they_come"] as const, "daily");
  await savePreference(user.id, lengthDraft(length));
  await savePreference(user.id, voiceDraft(voice));
  await savePreference(user.id, {
    kind: "style",
    key: "posting",
    value: { posting },
    label:
      posting === "daily"
        ? "One message each morning, then only what's urgent"
        : "Tell me things as they come, not in one morning message",
  });
  revalidatePath("/settings");
}
