"use server";

import { revalidatePath } from "next/cache";
import { ProfileError, clearCorrection, correctFact } from "@/lib/profile";
import { requireUser } from "@/lib/session";

// Correcting a fact on "What Jane knows about you" (spec step 253).

export type CorrectState = { key: string; message: string; ok: boolean } | null;

export async function correctProfileFact(
  _previous: CorrectState,
  formData: FormData,
): Promise<CorrectState> {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "");
  try {
    await correctFact(user.id, key, String(formData.get("answer") ?? ""));
  } catch (error) {
    if (error instanceof ProfileError) return { key, message: error.message, ok: false };
    throw error;
  }
  revalidatePath("/profile");
  return { key, message: "Thanks, I've got that.", ok: true };
}

export async function forgetProfileCorrection(formData: FormData): Promise<void> {
  const user = await requireUser();
  await clearCorrection(user.id, String(formData.get("key") ?? ""));
  revalidatePath("/profile");
}
