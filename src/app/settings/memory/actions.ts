"use server";

import { revalidatePath } from "next/cache";
import { correctFact, forgetEverything, forgetFact, MemoryError } from "@/lib/memory/facts";
import { requireUser } from "@/lib/session";

// "What Jane knows about you" (/settings/memory): correcting or forgetting one fact, or all of
// Jane's memory, always the signed-in person's own (the helpers scope to them and log each to
// the audit log).

export type CorrectMemoryState = { id: string; message: string; ok: boolean } | null;

export async function correctMemoryFact(
  _previous: CorrectMemoryState,
  formData: FormData,
): Promise<CorrectMemoryState> {
  const user = await requireUser();
  const id = String(formData.get("factId") ?? "");
  try {
    await correctFact(user.id, id, String(formData.get("answer") ?? ""));
  } catch (error) {
    if (error instanceof MemoryError) return { id, message: error.message, ok: false };
    throw error;
  }
  revalidatePath("/settings/memory");
  return { id, message: "Thanks, I've got that.", ok: true };
}

export async function forgetMemoryFact(formData: FormData): Promise<void> {
  const user = await requireUser();
  await forgetFact(user.id, String(formData.get("factId") ?? ""));
  revalidatePath("/settings/memory");
}

// Only with the box ticked: it can't be undone.
export async function forgetAllMemory(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (formData.get("confirm") !== "yes") return;
  await forgetEverything(user.id);
  revalidatePath("/settings/memory");
  revalidatePath("/chat");
}
